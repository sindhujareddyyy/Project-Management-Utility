import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { getTasks, saveTasks, getUsers, saveUsers } from './src/dbStore';
import { Task, User, TaskHistoryItem, TaskStatus, TaskPriority, TaskType } from './src/types';

const app = express();
const PORT = 3000;
const SIMULATED_API_KEY = 'pm-secret-token-123';

// Express parsing middleware
app.use(express.json());

// API Security Middleware (Simple API key simulation for mutating requests)
function secureApi(req: express.Request, res: express.Response, next: express.NextFunction) {
  // We only require API authorization for mutate operations to let read APIs work easily, or we can secure everything.
  // Let's secure ALL API endpoints except GET, or simple endpoints with a demonstration.
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (apiKey !== SIMULATED_API_KEY) {
      res.status(401).json({ error: 'Unauthorized: Invalid or missing API Key. Please provide x-api-key header.' });
      return;
    }
  }
  next();
}

app.use(secureApi);

// CORS support & debug logging
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-api-key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  console.log(`${req.method} ${req.url}`);
  next();
});

// --------------------------------------------------------
// USER CRUD API ENDPOINTS
// --------------------------------------------------------

// Get all users
app.get('/api/users', (req, res) => {
  try {
    const users = getUsers();
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create a user
app.post('/api/users', (req, res) => {
  try {
    const { name, email, role, avatarColor } = req.body;
    if (!name || !email || !role) {
       res.status(400).json({ error: 'Missing required user parameters' });
       return;
    }

    const users = getUsers();
    const newUser: User = {
      id: 'u_' + Math.random().toString(36).substr(2, 9),
      name,
      email,
      role,
      avatarColor: avatarColor || 'bg-slate-500',
    };

    users.push(newUser);
    saveUsers(users);
    res.status(201).json(newUser);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a user
app.delete('/api/users/:id', (req, res) => {
  try {
    const { id } = req.params;
    let users = getUsers();
    const userExists = users.some(u => u.id === id);
    if (!userExists) {
       res.status(404).json({ error: 'User not found' });
       return;
    }

    users = users.filter(u => u.id !== id);
    saveUsers(users);

    // Update tasks that had this user as assignee to be unassigned
    const tasks = getTasks();
    let updatedTasks = false;
    tasks.forEach(t => {
      if (t.assigneeId === id) {
        t.assigneeId = undefined;
        t.updatedAt = new Date().toISOString();
        t.history.push({
          id: 'hist_' + Math.random().toString(36).substr(2, 9),
          timestamp: new Date().toISOString(),
          type: 'assignee_change',
          description: `User assigned to this task was deleted. Task status remains ${t.status}.`,
          userName: 'System Room',
        });
        updatedTasks = true;
      }
    });
    if (updatedTasks) {
      saveTasks(tasks);
    }

    res.json({ success: true, message: 'User deleted and tasks unassigned' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// --------------------------------------------------------
// TASK CRUD API ENDPOINTS
// --------------------------------------------------------

// Get all tasks
app.get('/api/tasks', (req, res) => {
  try {
    const tasks = getTasks();
    res.json(tasks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get a specific task (with history)
app.get('/api/tasks/:id', (req, res) => {
  try {
    const { id } = req.params;
    const tasks = getTasks();
    const task = tasks.find(t => t.id === id);
    if (!task) {
       res.status(404).json({ error: 'Task not found' });
       return;
    }
    res.json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create a task
app.post('/api/tasks', (req, res) => {
  try {
    const { title, description, status, priority, type, assigneeId, category, authorName } = req.body;
    if (!title || !status || !priority || !type) {
       res.status(400).json({ error: 'Missing required task parameters' });
       return;
    }

    const tasks = getTasks();
    const taskId = 't_' + Math.random().toString(36).substr(2, 9);
    
    // Find assignee name if applicable
    let assigneeName = 'unassigned';
    if (assigneeId) {
      const users = getUsers();
      const assignedUser = users.find(u => u.id === assigneeId);
      if (assignedUser) assigneeName = assignedUser.name;
    }

    const creatorName = authorName || 'Project Manager';

    const newTask: Task = {
      id: taskId,
      title,
      description: description || '',
      status: status as TaskStatus,
      priority: priority as TaskPriority,
      type: type as TaskType,
      assigneeId: assigneeId || undefined,
      category: category || 'General',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [
        {
          id: 'hist_' + Math.random().toString(36).substr(2, 9),
          timestamp: new Date().toISOString(),
          type: 'create',
          description: `Task created with status '${status}', priority '${priority}', type '${type}', assigned to ${assigneeName}.`,
          userName: creatorName,
        }
      ]
    };

    tasks.push(newTask);
    saveTasks(tasks);
    res.status(201).json(newTask);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update a task (status change / details change, with auto hstory log!)
app.put('/api/tasks/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, status, priority, type, assigneeId, category, authorName } = req.body;
    
    const tasks = getTasks();
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex === -1) {
       res.status(404).json({ error: 'Task not found' });
       return;
    }

    const task = tasks[taskIndex];
    const editorName = authorName || 'Facilitator';
    const timestamp = new Date().toISOString();
    const changes: TaskHistoryItem[] = [];

    // Track status change
    if (status && status !== task.status) {
      changes.push({
        id: 'hist_' + Math.random().toString(36).substr(2, 9),
        timestamp,
        type: 'status_change',
        description: `Status changed from '${task.status}' to '${status}'.`,
        fieldChanged: 'status',
        oldValue: task.status,
        newValue: status,
        userName: editorName,
      });
      task.status = status as TaskStatus;
    }

    // Track assignee change
    if (assigneeId !== undefined && assigneeId !== task.assigneeId) {
      const users = getUsers();
      const oldUser = users.find(u => u.id === task.assigneeId)?.name || 'unassigned';
      const newUser = users.find(u => u.id === assigneeId)?.name || 'unassigned';

      changes.push({
        id: 'hist_' + Math.random().toString(36).substr(2, 9),
        timestamp,
        type: 'assignee_change',
        description: `Assignee modified from '${oldUser}' to '${newUser}'.`,
        fieldChanged: 'assigneeId',
        oldValue: oldUser,
        newValue: newUser,
        userName: editorName,
      });
      task.assigneeId = assigneeId || undefined;
    }

    // Track standard updates (title, text, type, priority, category)
    let detailChanges = [];
    if (title && title !== task.title) {
      detailChanges.push(`Title changed from "${task.title}" to "${title}"`);
      task.title = title;
    }
    if (description !== undefined && description !== task.description) {
      detailChanges.push(`Description updated`);
      task.description = description;
    }
    if (priority && priority !== task.priority) {
      detailChanges.push(`Priority changed from '${task.priority}' to '${priority}'`);
      task.priority = priority as TaskPriority;
    }
    if (type && type !== task.type) {
      detailChanges.push(`Type changed from '${task.type}' to '${type}'`);
      task.type = type as TaskType;
    }
    if (category && category !== task.category) {
      detailChanges.push(`Category changed from '${task.category || 'none'}' to '${category}'`);
      task.category = category;
    }

    if (detailChanges.length > 0) {
      changes.push({
        id: 'hist_' + Math.random().toString(36).substr(2, 9),
        timestamp,
        type: 'update',
        description: `Task properties updated: ${detailChanges.join(', ')}.`,
        userName: editorName,
      });
    }

    // Add changes to history
    if (changes.length > 0) {
      task.history = [...task.history, ...changes];
      task.updatedAt = timestamp;
    }

    tasks[taskIndex] = task;
    saveTasks(tasks);
    res.json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a task
app.delete('/api/tasks/:id', (req, res) => {
  try {
    const { id } = req.params;
    let tasks = getTasks();
    const taskExists = tasks.some(t => t.id === id);
    if (!taskExists) {
       res.status(404).json({ error: 'Task not found' });
       return;
    }

    tasks = tasks.filter(t => t.id !== id);
    saveTasks(tasks);
    res.json({ success: true, message: 'Task deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// --------------------------------------------------------
// SEED PRESETS DATABASE MOCK SEEDER ROUTE
// --------------------------------------------------------
app.post('/api/seed', (req, res) => {
  try {
    const { template } = req.body;
    let newUsers = [];
    let newTasks = [];

    if (template === 'fintech') {
      newUsers = [
        { id: 'u_fin_pm', name: 'Meera Iyer', email: 'meera.iyer@fintech-core.com', role: 'Product Manager', avatarColor: 'bg-teal-600' },
        { id: 'u_fin_arch', name: 'Rajesh Sharma', email: 'rajesh.sharma@fintech-core.com', role: 'Lead Architect', avatarColor: 'bg-indigo-600' },
        { id: 'u_fin_dev', name: 'Amit Verma', email: 'amit.verma@fintech-core.com', role: 'Backend Dev', avatarColor: 'bg-blue-600' },
        { id: 'u_fin_qa', name: 'Pooja Patil', email: 'pooja.patil@fintech-core.com', role: 'QA Engineer', avatarColor: 'bg-rose-500' }
      ];

      newTasks = [
        {
          id: 't_fin_1',
          title: 'PCI-DSS Compliant Credit Card Tokenization Proxy setup',
          description: 'Design a secure proxy microservice that intercepts card payload requests and replaces sensitive numbers with hashed tokens. Must support rapid key rotation rules.',
          status: 'todo',
          priority: 'high',
          type: 'feature',
          assigneeId: 'u_fin_arch',
          category: 'Core Payments',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          history: [
            {
              id: 'h_fin_1',
              timestamp: new Date().toISOString(),
              type: 'create',
              description: 'Task initialized automatically by Fintech Ledger blueprint template.',
              userName: 'Sponsor Lead'
            }
          ]
        },
        {
          id: 't_fin_2',
          title: 'Resolve transaction race condition in ledger tables',
          description: 'Evaluators flagged concurrent balance edits as causing desynced totals. Apply SELECT FOR UPDATE pessimistic locking models on SQL transaction streams.',
          status: 'in_progress',
          priority: 'high',
          type: 'bug',
          assigneeId: 'u_fin_dev',
          category: 'Relational Ledger',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          history: [
            {
              id: 'h_fin_2',
              timestamp: new Date().toISOString(),
              type: 'create',
              description: 'Task initialized via seed module. Critical core payments optimization.',
              userName: 'Meera Iyer'
            }
          ]
        },
        {
          id: 't_fin_3',
          title: 'Automatic settlement microservices load testing',
          description: 'Conduct sandboxed endpoints scale testing. Confirm responses clock in below 45ms latency under 6000 concurrent API calls.',
          status: 'in_review',
          priority: 'medium',
          type: 'chore',
          assigneeId: 'u_fin_qa',
          category: 'QA Quality',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          history: [
            {
              id: 'h_fin_3',
              timestamp: new Date().toISOString(),
              type: 'create',
              description: 'Stress-testing verification suite loaded.',
              userName: 'Pooja Patil'
            }
          ]
        },
        {
          id: 't_fin_4',
          title: 'Draft standard operating compliance audit manifest',
          description: 'Formulate dual-signoff release logs guidelines conforming fully with international banking standards and RBI directives.',
          status: 'done',
          priority: 'low',
          type: 'documentation',
          assigneeId: 'u_fin_pm',
          category: 'Compliance',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          history: [
            {
              id: 'h_fin_4',
              timestamp: new Date().toISOString(),
              type: 'create',
              description: 'Documentation draft recorded as completed.',
              userName: 'Meera Iyer'
            }
          ]
        }
      ];
    } else {
      // Default to genai
      newUsers = [
        { id: 'u_ai_pm', name: 'Sruthi Nair', email: 'sruthi.nair@cognitive.io', role: 'Product Manager', avatarColor: 'bg-pink-600' },
        { id: 'u_ai_eng', name: 'Vivek Anand', email: 'vivek.anand@cognitive.io', role: 'Backend Dev', avatarColor: 'bg-purple-600' },
        { id: 'u_ai_ds', name: 'Kunal Sen', email: 'kunal.sen@cognitive.io', role: 'DevOps Specialist', avatarColor: 'bg-indigo-600' }
      ];

      newTasks = [
        {
          id: 't_ai_1',
          title: 'Configure chunk-pipeline embeddings for enterprise RAG',
          description: 'Construct robust recursive text partitioners matching token targets. Push vectorized float arrays directly into semantic cache indexes.',
          status: 'in_progress',
          priority: 'high',
          type: 'feature',
          assigneeId: 'u_ai_eng',
          category: 'LLM Pipeline',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          history: [
            {
              id: 'h_ai_1',
              timestamp: new Date().toISOString(),
              type: 'create',
              description: 'Pipeline bootstrap executed.',
              userName: 'Kunal Sen'
            }
          ]
        },
        {
          id: 't_ai_2',
          title: 'Fix prompt injection escape context vulnerabilities',
          description: 'Harden defensive system directives. Establish positive validation loops blocking arbitrary runtime injection overrides.',
          status: 'in_review',
          priority: 'high',
          type: 'bug',
          assigneeId: 'u_ai_ds',
          category: 'LLM Security',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          history: [
            {
              id: 'h_ai_2',
              timestamp: new Date().toISOString(),
              type: 'create',
              description: 'Red team security penetration vulnerabilities reported.',
              userName: 'Sruthi Nair'
            }
          ]
        },
        {
          id: 't_ai_3',
          title: 'Migrate summary stream endpoint to Server-Sent-Events',
          description: 'Transform traditional JSON fetch polling routes into active SSE token streaming arrays to reduce first-byte delay from 1400ms down to 40ms.',
          status: 'todo',
          priority: 'medium',
          type: 'feature',
          assigneeId: 'u_ai_eng',
          category: 'AI Interface',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          history: [
            {
              id: 'h_ai_3',
              timestamp: new Date().toISOString(),
              type: 'create',
              description: 'Draft performance schema map registered.',
              userName: 'Vivek Anand'
            }
          ]
        }
      ];
    }

    saveUsers(newUsers);
    saveTasks(newTasks);

    res.json({ success: true, message: `Successfully seeded dataset with ${template} template!`, tasks: newTasks, users: newUsers });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// --------------------------------------------------------
// VITE CLIENT MIDDLEWARE HOOK FOR ASSETS DEV/PROD
// --------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Express server + Vite middleware loaded and listening on port ${PORT}`);
  });
}

startServer();
