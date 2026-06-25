import express, { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Define extended request type to hold the authenticated user
interface AuthenticatedRequest extends Request {
  user?: any;
}

const PORT = 3000;
const DB_PATH = path.join(process.cwd(), "data", "db.json");

// Ensure data folder exists
if (!fs.existsSync(path.join(process.cwd(), "data"))) {
  fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
}

// In-Memory Database State
interface DBState {
  users: Record<string, any>;
  tasks: Record<string, any[]>;
  tokens: Record<string, string>; // token -> userId
  notifications: Record<string, any[]>;
}

let db: DBState = {
  users: {},
  tasks: {},
  tokens: {},
  notifications: {}
};

// Seed leaderboard users if not exists
const SEED_USERS = [
  { id: "seed_1", name: "Elena Vance", points: 1240, tasksCompleted: 48, completionRate: 96, avatarUrl: "https://api.dicebear.com/7.x/adventurer/svg?seed=elena", rankName: "Diamond" },
  { id: "seed_2", name: "Arthur Pendragon", points: 980, tasksCompleted: 38, completionRate: 92, avatarUrl: "https://api.dicebear.com/7.x/adventurer/svg?seed=arthur", rankName: "Platinum" },
  { id: "seed_3", name: "Sarah Connor", points: 890, tasksCompleted: 35, completionRate: 89, avatarUrl: "https://api.dicebear.com/7.x/adventurer/svg?seed=sarah", rankName: "Gold" },
  { id: "seed_4", name: "Garrus Vakarian", points: 760, tasksCompleted: 30, completionRate: 85, avatarUrl: "https://api.dicebear.com/7.x/adventurer/svg?seed=garrus", rankName: "Gold" },
  { id: "seed_5", name: "Zelda of Hyrule", points: 650, tasksCompleted: 24, completionRate: 88, avatarUrl: "https://api.dicebear.com/7.x/adventurer/svg?seed=zelda", rankName: "Silver" },
  { id: "seed_6", name: "Peter Parker", points: 540, tasksCompleted: 20, completionRate: 80, avatarUrl: "https://api.dicebear.com/7.x/adventurer/svg?seed=peter", rankName: "Silver" },
  { id: "seed_7", name: "Diana Prince", points: 420, tasksCompleted: 15, completionRate: 84, avatarUrl: "https://api.dicebear.com/7.x/adventurer/svg?seed=diana", rankName: "Bronze" },
  { id: "seed_8", name: "Bruce Wayne", points: 310, tasksCompleted: 11, completionRate: 78, avatarUrl: "https://api.dicebear.com/7.x/adventurer/svg?seed=bruce", rankName: "Bronze" },
  { id: "seed_9", name: "Clark Kent", points: 180, tasksCompleted: 6, completionRate: 75, avatarUrl: "https://api.dicebear.com/7.x/adventurer/svg?seed=clark", rankName: "Bronze" }
];

// Load Database
function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, "utf-8");
      db = JSON.parse(raw);
      // Ensure all fields exist
      if (!db.users) db.users = {};
      if (!db.tasks) db.tasks = {};
      if (!db.tokens) db.tokens = {};
      if (!db.notifications) db.notifications = {};
    } else {
      saveDB();
    }
  } catch (err) {
    console.error("Error loading DB, resetting in-memory", err);
  }
}

// Save Database
function saveDB() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving DB to file", err);
  }
}

loadDB();

const DEFAULT_USER_ID = "guest_user";
const DEFAULT_USER_TOKEN = "default_guest_token";

function ensureDefaultUser() {
  if (!db.users[DEFAULT_USER_ID]) {
    db.users[DEFAULT_USER_ID] = {
      id: DEFAULT_USER_ID,
      name: "Guest Champion",
      email: "pavithranm08012008@gmail.com",
      avatarUrl: "https://api.dicebear.com/7.x/adventurer/svg?seed=Guest",
      occupation: "Professional",
      dailyAvailableHours: 4,
      points: 250,
      tasksCompleted: 8,
      completionRate: 85,
      streak: 3,
      highestStreak: 5,
      productivityScore: 88,
      plan: "premium",
      freeCompletionsRemaining: 999,
      premiumUsageCount: 0,
      rewardHistory: [],
      verified: true
    };
    db.tasks[DEFAULT_USER_ID] = [
      {
        id: "task_1",
        title: "Master Task Kingdom gamified rules",
        category: "Learning",
        priority: "High",
        deadline: new Date().toISOString().split("T")[0],
        estimatedHours: 2,
        completed: false,
        subtasks: [
          { id: "sub_1", title: "Complete at least one focus session", completed: false },
          { id: "sub_2", title: "Claim a reward from the rewards tab", completed: false }
        ],
        aiWorkSessions: [
          { id: "sess_1", title: "Read Kingdom Arena rules", date: new Date().toISOString().split("T")[0], completed: false, durationMinutes: 60 }
        ]
      },
      {
        id: "task_2",
        title: "Explore AI Steps generation",
        category: "Work",
        priority: "Medium",
        deadline: new Date(Date.now() + 86400000).toISOString().split("T")[0],
        estimatedHours: 3,
        completed: false,
        subtasks: [
          { id: "sub_3", title: "Click 'AI Steps' icon inside this task", completed: false },
          { id: "sub_4", title: "Observe automatic breakdown into milestones", completed: false }
        ],
        aiWorkSessions: [
          { id: "sess_2", title: "Execute task subgoals", date: new Date(Date.now() + 86400000).toISOString().split("T")[0], completed: false, durationMinutes: 90 }
        ]
      }
    ];
    db.notifications[DEFAULT_USER_ID] = [
      {
        id: "notif_welcome",
        userId: DEFAULT_USER_ID,
        title: "Welcome, Champion!",
        message: "No accounts or passwords needed! We loaded a fully featured workspace with full AI access active. Start planning now!",
        type: "success",
        read: false,
        timestamp: new Date().toISOString()
      }
    ];
  }
  db.tokens[DEFAULT_USER_TOKEN] = DEFAULT_USER_ID;
  saveDB();
}

ensureDefaultUser();

// Helper to calculate rank based on points
function getRankName(points: number): string {
  if (points < 200) return "Bronze";
  if (points < 500) return "Silver";
  if (points < 800) return "Gold";
  if (points < 1100) return "Platinum";
  if (points < 1500) return "Diamond";
  if (points < 2000) return "Master";
  return "Task Kingdom Legend";
}

// Lazy load Gemini AI to avoid crash if API key is missing on startup
let aiClient: GoogleGenAI | null = null;
function getAIInstance(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key || key === "MY_GEMINI_API_KEY") {
      throw new Error("GEMINI_API_KEY environment variable is not configured in secrets.");
    }
    aiClient = new GoogleGenAI({ apiKey: key });
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // CORS-like header support for development iframe boundaries
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  // Auth Middleware
  const authMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Access token required" });
      return;
    }
    const token = authHeader.split(" ")[1];
    const userId = db.tokens[token];
    if (!userId || !db.users[userId]) {
      res.status(401).json({ error: "Invalid or expired session token" });
      return;
    }
    req.user = db.users[userId];
    next();
  };

  // --- API ROUTES ---

  // Auth: Register
  app.post("/api/auth/register", (req: Request, res: Response) => {
    const { name, email, password, occupation, dailyAvailableHours } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are required" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    // Check if user exists
    const userExists = Object.values(db.users).some((u: any) => u.email.toLowerCase() === normalizedEmail);
    if (userExists) {
      return res.status(400).json({ error: "An account with this email already exists" });
    }

    const userId = "user_" + crypto.randomUUID();
    const hash = crypto.createHash("sha256").update(password).digest("hex");
    const avatarSeed = name.replace(/\s+/g, "");

    const newUser = {
      id: userId,
      name,
      email: normalizedEmail,
      passwordHash: hash,
      avatarUrl: `https://api.dicebear.com/7.x/adventurer/svg?seed=${avatarSeed}`,
      occupation: occupation || "Professional",
      dailyAvailableHours: Number(dailyAvailableHours) || 4,
      points: 100, // starting points
      tasksCompleted: 0,
      completionRate: 0,
      streak: 1,
      highestStreak: 1,
      productivityScore: 70, // default productivity baseline
      plan: "free",
      freeCompletionsRemaining: 3,
      premiumUsageCount: 0,
      rewardHistory: [],
      verified: true
    };

    db.users[userId] = newUser;
    db.tasks[userId] = [];
    db.notifications[userId] = [
      {
        id: "notif_welcome",
        userId,
        title: "Welcome to Task Tracker!",
        message: "Plan, schedule, and complete tasks to build your Task Kingdom points. Tap 'AI Steps' on any task for a free breakdown roadmap!",
        type: "success",
        read: false,
        timestamp: new Date().toISOString()
      }
    ];

    // Create session token
    const token = crypto.randomBytes(32).toString("hex");
    db.tokens[token] = userId;
    saveDB();

    res.json({ token, user: newUser });
  });

  // Auth: Login
  app.post("/api/auth/login", (req: Request, res: Response) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user: any = Object.values(db.users).find((u: any) => u.email.toLowerCase() === normalizedEmail);

    if (!user) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const hash = crypto.createHash("sha256").update(password).digest("hex");
    if (user.passwordHash !== hash) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    // Create session token
    const token = crypto.randomBytes(32).toString("hex");
    db.tokens[token] = user.id;
    saveDB();

    res.json({ token, user });
  });

  // Auth: Forgot Password
  app.post("/api/auth/forgot-password", (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }
    // Simulation of forgot password link dispatch
    res.json({ message: "A recovery verification email has been successfully sent to your registered address." });
  });

  // Auth: Verify Email
  app.post("/api/auth/verify-email", (req: Request, res: Response) => {
    const { email, code } = req.body;
    res.json({ message: "Email has been successfully verified!" });
  });

  // Auth: Fetch Session
  app.get("/api/auth/session", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    res.json({ user: req.user });
  });

  // Auth: Update Profile Settings
  app.post("/api/auth/profile", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    const { name, occupation, dailyAvailableHours, avatarUrl } = req.body;
    const userId = req.user.id;

    if (db.users[userId]) {
      if (name) db.users[userId].name = name;
      if (occupation) db.users[userId].occupation = occupation;
      if (dailyAvailableHours !== undefined) db.users[userId].dailyAvailableHours = Number(dailyAvailableHours);
      if (avatarUrl) db.users[userId].avatarUrl = avatarUrl;
      saveDB();
      res.json({ user: db.users[userId] });
    } else {
      res.status(404).json({ error: "User profile not found" });
    }
  });

  // Tasks: Fetch Tasks
  app.get("/api/tasks", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user.id;
    const tasks = db.tasks[userId] || [];
    res.json(tasks);
  });

  // Tasks: Create Task
  app.post("/api/tasks", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user.id;
    const { title, description, category, deadline, estimatedHours, priority, reminderSettings, notes } = req.body;

    if (!title || !deadline) {
      return res.status(400).json({ error: "Task title and deadline date are required" });
    }

    const newTask = {
      id: "task_" + crypto.randomUUID(),
      userId,
      title,
      description: description || "",
      category: category || "General",
      deadline, // YYYY-MM-DD
      estimatedHours: Number(estimatedHours) || 1,
      priority: priority || "Medium",
      reminderSettings: reminderSettings || {
        enabled: false,
        interval: "Daily",
        times: ["09:00"],
        channels: ["In-App"]
      },
      completed: false,
      notes: notes || "",
      subtasks: [],
      aiRoadmapGenerated: false,
      aiScheduleAvailable: false
    };

    if (!db.tasks[userId]) {
      db.tasks[userId] = [];
    }
    db.tasks[userId].push(newTask);
    saveDB();

    res.json(newTask);
  });

  // Tasks: Update Task
  app.put("/api/tasks/:id", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user.id;
    const taskId = req.params.id;
    const updateFields = req.body;

    const userTasks = db.tasks[userId] || [];
    const taskIndex = userTasks.findIndex((t: any) => t.id === taskId);

    if (taskIndex === -1) {
      return res.status(404).json({ error: "Task not found" });
    }

    // Merge existing fields with new fields
    const updatedTask = {
      ...userTasks[taskIndex],
      ...updateFields
    };

    userTasks[taskIndex] = updatedTask;
    db.tasks[userId] = userTasks;

    // Recalculate user statistics
    const totalTasks = userTasks.length;
    const completedTasks = userTasks.filter((t: any) => t.completed).length;
    db.users[userId].tasksCompleted = completedTasks;
    db.users[userId].completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    saveDB();
    res.json(updatedTask);
  });

  // Tasks: Delete Task
  app.delete("/api/tasks/:id", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user.id;
    const taskId = req.params.id;

    const userTasks = db.tasks[userId] || [];
    const filteredTasks = userTasks.filter((t: any) => t.id !== taskId);

    db.tasks[userId] = filteredTasks;

    // Recalculate user statistics
    const totalTasks = filteredTasks.length;
    const completedTasks = filteredTasks.filter((t: any) => t.completed).length;
    db.users[userId].tasksCompleted = completedTasks;
    db.users[userId].completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    saveDB();
    res.json({ success: true });
  });

  // Tasks: Toggle Subtask
  app.post("/api/tasks/:id/toggle-subtask", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user.id;
    const taskId = req.params.id;
    const { subtaskId } = req.body;

    const userTasks = db.tasks[userId] || [];
    const task = userTasks.find((t: any) => t.id === taskId);

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    const subtask = task.subtasks.find((st: any) => st.id === subtaskId);
    if (!subtask) {
      return res.status(404).json({ error: "Subtask not found" });
    }

    subtask.completed = !subtask.completed;

    // Points calculation: completed subtask +5 points, uncompleted -5 points
    const pointDelta = subtask.completed ? 5 : -5;
    db.users[userId].points = Math.max(0, db.users[userId].points + pointDelta);

    // Logging notifications for rewards
    if (subtask.completed) {
      db.notifications[userId].push({
        id: "notif_st_" + crypto.randomUUID(),
        userId,
        title: "Subtask Completed!",
        message: `You earned +5 Task Kingdom Points for completing: "${subtask.title}"`,
        type: "success",
        read: false,
        timestamp: new Date().toISOString()
      });
    }

    saveDB();
    res.json({ task, user: db.users[userId] });
  });

  // Tasks: Complete Main Task
  app.post("/api/tasks/:id/complete", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user.id;
    const taskId = req.params.id;
    const { completed } = req.body;

    const userTasks = db.tasks[userId] || [];
    const task = userTasks.find((t: any) => t.id === taskId);

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    const wasCompleted = task.completed;
    task.completed = completed;
    task.completedAt = completed ? new Date().toISOString() : undefined;

    // Point additions & penalties
    let pointsEarned = 0;
    if (completed && !wasCompleted) {
      const todayStr = new Date().toISOString().split("T")[0];
      const deadlineStr = task.deadline;

      if (todayStr < deadlineStr) {
        // Before deadline
        pointsEarned = 20;
        db.notifications[userId].push({
          id: "notif_comp_" + crypto.randomUUID(),
          userId,
          title: "Speedy Completion!",
          message: `Awesome! You completed "${task.title}" BEFORE the deadline. Earned +20 points!`,
          type: "success",
          read: false,
          timestamp: new Date().toISOString()
        });
      } else if (todayStr === deadlineStr) {
        // On deadline
        pointsEarned = 10;
        db.notifications[userId].push({
          id: "notif_comp_" + crypto.randomUUID(),
          userId,
          title: "On the Dot!",
          message: `Completed "${task.title}" on the deadline day. Earned +10 points!`,
          type: "success",
          read: false,
          timestamp: new Date().toISOString()
        });
      } else {
        // Overdue task completed
        pointsEarned = 5;
        db.notifications[userId].push({
          id: "notif_comp_" + crypto.randomUUID(),
          userId,
          title: "Better Late than Never",
          message: `Completed "${task.title}". Since it was overdue, you earned +5 points.`,
          type: "info",
          read: false,
          timestamp: new Date().toISOString()
        });
      }
    } else if (!completed && wasCompleted) {
      // Reverted task completion
      pointsEarned = -15; // penalty
    }

    // Apply points
    db.users[userId].points = Math.max(0, db.users[userId].points + pointsEarned);

    // Dynamic Streak check
    if (completed && !wasCompleted) {
      // Simple daily streak increment on completing first task of the day
      // Check if user has already completed a task today
      const todayDateStr = new Date().toISOString().split("T")[0];
      const completedTodayCount = userTasks.filter((t: any) => t.completed && t.completedAt && t.completedAt.startsWith(todayDateStr)).length;

      if (completedTodayCount === 1) {
        // First task today! Increment streak and give points
        db.users[userId].streak += 1;
        db.users[userId].points += 15; // streak bonus points
        if (db.users[userId].streak > db.users[userId].highestStreak) {
          db.users[userId].highestStreak = db.users[userId].streak;
        }

        db.notifications[userId].push({
          id: "notif_streak_" + crypto.randomUUID(),
          userId,
          title: "Streak Maintained!",
          message: `Streak increases to ${db.users[userId].streak} days! Earned +15 bonus streak points!`,
          type: "success",
          read: false,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Recalculate stats
    const totalTasks = userTasks.length;
    const completedTasks = userTasks.filter((t: any) => t.completed).length;
    db.users[userId].tasksCompleted = completedTasks;
    db.users[userId].completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // Recalculate productivity score
    // Higher completion rate + on-time tasks increases productivity score
    const scoreBase = db.users[userId].completionRate * 0.7 + (db.users[userId].streak > 5 ? 30 : db.users[userId].streak * 5);
    db.users[userId].productivityScore = Math.min(100, Math.max(30, Math.round(scoreBase)));

    saveDB();
    res.json({ task, user: db.users[userId] });
  });

  // AI Route: Steps Assistant (Free For Everyone)
  app.post("/api/tasks/:id/ai-steps", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user.id;
    const taskId = req.params.id;

    const userTasks = db.tasks[userId] || [];
    const task = userTasks.find((t: any) => t.id === taskId);

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    try {
      const ai = getAIInstance();
      const prompt = `You are an expert task advisor. Analyze this task:
Title: "${task.title}"
Description: "${task.description}"
Category: "${task.category}"
Priority: "${task.priority}"

Break it down into a highly actionable, structured, step-by-step roadmap. Provide:
1. A list of 4 to 8 granular steps.
2. A list of 2 to 3 suggested learning resources, templates, or URLs.
3. Realistic estimate of completion time in hours.
4. A short encouraging strategic roadmap message.

You MUST respond ONLY with a valid JSON object matching this structure exactly (do not output markdown ticks outside the JSON):
{
  "subtasks": ["step 1", "step 2", "step 3"],
  "resources": ["resource 1 description", "resource 2 link"],
  "estimatedHours": 8,
  "roadmap": "roadmap strategic overview message"
}`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const responseText = response.text || "{}";
      const result = JSON.parse(responseText);

      // Inject steps as subtasks
      if (result.subtasks && Array.isArray(result.subtasks)) {
        task.subtasks = result.subtasks.map((title: string) => ({
          id: "subtask_" + crypto.randomUUID().slice(0, 8),
          title,
          completed: false
        }));
      }

      task.aiRoadmapGenerated = true;
      task.aiSuggestedResources = result.resources || [];
      if (result.estimatedHours) {
        task.estimatedHours = Number(result.estimatedHours);
      }
      task.notes = (task.notes ? task.notes + "\n\n" : "") + "AI Roadmap Suggestion:\n" + (result.roadmap || "");

      saveDB();
      res.json({ task, roadmap: result.roadmap });

    } catch (err: any) {
      console.error("Gemini API Error in AI Steps:", err);
      // Fallback response for missing API keys or timeout
      task.subtasks = [
        { id: "subtask_fb1", title: "Collect relevant datasets or references", completed: false },
        { id: "subtask_fb2", title: "Structure project requirements outline", completed: false },
        { id: "subtask_fb3", title: "Execute phase 1 development/writing", completed: false },
        { id: "subtask_fb4", title: "Test, evaluate, and refine outcome", completed: false },
        { id: "subtask_fb5", title: "Deploy, submit, or deliver final files", completed: false }
      ];
      task.aiRoadmapGenerated = true;
      task.aiSuggestedResources = [
        "Google Developers Search - Best Coding Frameworks",
        "Kaggle Datasets Hub - Source Data & Insights"
      ];
      task.notes = (task.notes ? task.notes + "\n\n" : "") + "AI Roadmap Suggestion (Fallback Enabled):\nBreak down requirements early and work iteratively in 45-minute sprint blocks to optimize retention and completion rates.";
      
      saveDB();
      res.json({ task, roadmap: "Fallback roadmap applied due to offline mode or API key wait time." });
    }
  });

  // AI Route: Smart Schedule Generator (Free For Everyone)
  app.post("/api/tasks/:id/ai-schedule", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user.id;
    const taskId = req.params.id;

    const userTasks = db.tasks[userId] || [];
    const task = userTasks.find((t: any) => t.id === taskId);

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    const dailyHours = req.user.dailyAvailableHours || 4;

    try {
      const ai = getAIInstance();
      const todayStr = new Date().toISOString().split("T")[0];
      const prompt = `You are a Smart Time-Blocking Scheduler.
Task: "${task.title}" (Estimated hours required: ${task.estimatedHours})
Deadline: "${task.deadline}"
Current Date Context: "${todayStr}"
User's Daily Available Time: ${dailyHours} Hours/Day

Create a custom daily calendar scheduling breakdown. Distribute the hours across days starting from today up until the deadline. Do not allocate more than ${dailyHours} hours on any single day.
Return strictly a JSON object matching this structure exactly (do not output markdown wrappers):
{
  "sessions": [
    {
      "day": 1,
      "date": "YYYY-MM-DD",
      "title": "Subtask work block title description",
      "hours": 2
    }
  ]
}`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const responseText = response.text || "{}";
      const result = JSON.parse(responseText);

      if (result.sessions && Array.isArray(result.sessions)) {
        task.aiWorkSessions = result.sessions.map((sess: any) => ({
          id: "session_" + crypto.randomUUID().slice(0, 8),
          day: Number(sess.day) || 1,
          date: sess.date || task.deadline,
          title: sess.title || "Allocated work block",
          hours: Number(sess.hours) || 1,
          completed: false
        }));
        task.aiScheduleAvailable = true;
      }

      saveDB();
      res.json(task);

    } catch (err: any) {
      console.error("Gemini API Error in AI Schedule:", err);
      // Fallback schedule generator
      const sessions = [];
      const deadlineDate = new Date(task.deadline);
      const todayDate = new Date();
      const diffTime = Math.max(1, Math.ceil((deadlineDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24)));
      const daysCount = Math.min(diffTime, 10);

      const hoursPerDay = Math.min(dailyHours, Math.ceil(task.estimatedHours / daysCount));

      for (let i = 1; i <= daysCount; i++) {
        const workDate = new Date();
        workDate.setDate(todayDate.getDate() + (i - 1));
        const workDateStr = workDate.toISOString().split("T")[0];

        sessions.push({
          id: "session_fb" + i,
          day: i,
          date: workDateStr,
          title: `Focus Sprint Part ${i}: Core progress milestones`,
          hours: hoursPerDay,
          completed: false
        });
      }

      task.aiWorkSessions = sessions;
      task.aiScheduleAvailable = true;
      saveDB();
      res.json(task);
    }
  });

  // AI Route: Completion Generator (Premium - first 3 free, then checks plan)
  app.post("/api/tasks/:id/ai-complete", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user.id;
    const taskId = req.params.id;
    const { actionType, customPrompt } = req.body; // e.g. "Draft Report", "Write Summary", "Study Plan"

    const userTasks = db.tasks[userId] || [];
    const task = userTasks.find((t: any) => t.id === taskId);

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    const user = db.users[userId];

    // Premium logic check
    if (user.plan === "free" && user.freeCompletionsRemaining <= 0) {
      return res.status(403).json({
        error: "Premium subscription is required. You have utilized all 3 free completions.",
        limitsExceeded: true
      });
    }

    try {
      const ai = getAIInstance();
      const prompt = `You are a professional assistant designed to help complete a specific task.
Task: "${task.title}"
Description: "${task.description}"
Category: "${task.category}"
Action Requested: "${actionType}"
User Context Details: "${customPrompt || ""}"

Write a comprehensive, professional, complete output that resolves this task. For instance, if a report is requested, write the complete, thorough report with markdown headers, outlines, tables, and details. If a study plan is requested, output a complete day-by-day markdown checklist.
Deliver high value, and write complete answers rather than summaries.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt
      });

      const outputMarkdown = response.text || "No response generated.";

      // Deduct or track usage
      if (user.plan === "free") {
        user.freeCompletionsRemaining = Math.max(0, user.freeCompletionsRemaining - 1);
      } else {
        user.premiumUsageCount += 1;
      }

      // Add points for completing tasks digitally
      user.points = Math.max(0, user.points + 10);
      db.notifications[userId].push({
        id: "notif_premium_" + crypto.randomUUID(),
        userId,
        title: "AI Draft Complete!",
        message: `Your requested professional artifact has been drafted! Remaining Free Completions: ${user.freeCompletionsRemaining}`,
        type: "success",
        read: false,
        timestamp: new Date().toISOString()
      });

      saveDB();
      res.json({ output: outputMarkdown, user });

    } catch (err: any) {
      console.error("Gemini API Error in AI Complete:", err);
      // Fallback mock artifact
      const fallbackMarkdown = `
# Professional Draft for: ${task.title}
*Prepared via local offline generator mode.*

## Executive Summary
This document provides a highly structured framework for the completion of the project title **"${task.title}"**. Focused on efficiency, clean integration, and robust milestones.

## Step-by-Step Deliverables
1. **Requirements & Alignment**: Validate client specifications and data layers.
2. **Implementation Core**: Build key components, mock APIs, and view controls.
3. **Validation & Polish**: Ensure accessible layouts and test loading states under standard connections.

---
*Created on: ${new Date().toLocaleDateString()}*
      `;

      if (user.plan === "free") {
        user.freeCompletionsRemaining = Math.max(0, user.freeCompletionsRemaining - 1);
      } else {
        user.premiumUsageCount += 1;
      }

      saveDB();
      res.json({ output: fallbackMarkdown, user });
    }
  });

  // Schedule Rescheduling: Automated recovery plan for missed scheduled sessions
  app.post("/api/tasks/reschedule-missed", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user.id;
    const { taskId } = req.body;

    const userTasks = db.tasks[userId] || [];
    const task = userTasks.find((t: any) => t.id === taskId);

    if (!task || !task.aiWorkSessions || task.aiWorkSessions.length === 0) {
      return res.status(400).json({ error: "Task or schedule work sessions not found" });
    }

    const todayStr = new Date().toISOString().split("T")[0];
    let missedCount = 0;

    // Detect missed work sessions (scheduled in the past, but not marked completed)
    task.aiWorkSessions.forEach((sess: any) => {
      if (sess.date < todayStr && !sess.completed) {
        missedCount++;
        // Shift this session forward
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + missedCount);
        sess.date = futureDate.toISOString().split("T")[0];
      }
    });

    if (missedCount > 0) {
      db.users[userId].points = Math.max(0, db.users[userId].points - (missedCount * 5)); // penalty for missed slots
      
      db.notifications[userId].push({
        id: "notif_missed_" + crypto.randomUUID(),
        userId,
        title: "Schedule Automatically Adjusted!",
        message: `We detected ${missedCount} missed scheduled focus session(s). Your remaining schedule has been automatically deferred to keep you on track.`,
        type: "warning",
        read: false,
        timestamp: new Date().toISOString()
      });
      saveDB();
      res.json({ task, user: db.users[userId], adjusted: true, message: "We adjusted your sessions." });
    } else {
      res.json({ task, adjusted: false, message: "No missed sessions detected." });
    }
  });

  // Notifications: Fetch
  app.get("/api/notifications", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user.id;
    const notifs = db.notifications[userId] || [];
    res.json(notifs);
  });

  // Notifications: Mark Read
  app.post("/api/notifications/mark-read", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user.id;
    const { id } = req.body;

    const userNotifs = db.notifications[userId] || [];
    if (id === "all") {
      userNotifs.forEach((n: any) => n.read = true);
    } else {
      const n = userNotifs.find((item: any) => item.id === id);
      if (n) n.read = true;
    }

    db.notifications[userId] = userNotifs;
    saveDB();
    res.json(userNotifs);
  });

  // Leaderboard: Fetch Unified Board
  app.get("/api/kingdom/leaderboard", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user.id;
    const user = db.users[userId];

    // Combine current user with seeds
    const allPlayers = SEED_USERS.map((su: any) => ({ ...su, isCurrentUser: false }));
    
    // Add current user
    allPlayers.push({
      id: user.id,
      name: user.name + " (You)",
      points: user.points,
      tasksCompleted: user.tasksCompleted,
      completionRate: user.completionRate,
      avatarUrl: user.avatarUrl,
      rankName: getRankName(user.points),
      isCurrentUser: true
    });

    // Sort descending by points
    allPlayers.sort((a, b) => b.points - a.points);

    res.json(allPlayers);
  });

  // Rewards: Fetch
  app.get("/api/kingdom/rewards", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user.id;
    const user = db.users[userId];

    const eligibility = {
      isEligible: user.points >= 1000 || user.tasksCompleted >= 20,
      pointsRequired: Math.max(0, 1000 - user.points),
      tasksRequired: Math.max(0, 20 - user.tasksCompleted)
    };

    const monthlyRewards = [
      { id: "rew_1", name: "1 Month Task Tracker Premium Key", type: "Premium Key", value: "$9.99", pointsCost: 800 },
      { id: "rew_2", name: "$15 Amazon Gift Card Voucher", type: "Gift Card", value: "$15.00", pointsCost: 1500 },
      { id: "rew_3", name: "Official Task Kingdom Merchandise Cap", type: "Merchandise", value: "$20.00", pointsCost: 1800 },
      { id: "rew_4", name: "Task Kingdom Champion Verified Certificate", type: "Certificate", value: "Priceless", pointsCost: 500 }
    ];

    res.json({
      eligibility,
      rewards: monthlyRewards,
      history: user.rewardHistory || []
    });
  });

  // Rewards: Claim Reward
  app.post("/api/kingdom/claim-reward", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user.id;
    const { rewardId } = req.body;
    const user = db.users[userId];

    const rewards = [
      { id: "rew_1", name: "1 Month Task Tracker Premium Key", type: "Premium Key", pointsCost: 800 },
      { id: "rew_2", name: "$15 Amazon Gift Card Voucher", type: "Gift Card", pointsCost: 1500 },
      { id: "rew_3", name: "Official Task Kingdom Merchandise Cap", type: "Merchandise", pointsCost: 1800 },
      { id: "rew_4", name: "Task Kingdom Champion Verified Certificate", type: "Certificate", pointsCost: 500 }
    ];

    const targetRew = rewards.find((r: any) => r.id === rewardId);
    if (!targetRew) {
      return res.status(404).json({ error: "Reward item not found" });
    }

    if (user.points < targetRew.pointsCost) {
      return res.status(400).json({ error: `Insufficient points. You need ${targetRew.pointsCost} points to claim this reward.` });
    }

    // Deduct points
    user.points -= targetRew.pointsCost;

    const claimCode = "TK-" + crypto.randomBytes(4).toString("hex").toUpperCase();
    const newClaim = {
      id: "claim_" + crypto.randomUUID().slice(0, 8),
      month: new Date().toLocaleString("default", { month: "long", year: "numeric" }),
      rewardName: targetRew.name,
      claimed: true,
      dateClaimed: new Date().toISOString(),
      type: targetRew.type,
      code: claimCode
    };

    if (!user.rewardHistory) {
      user.rewardHistory = [];
    }
    user.rewardHistory.push(newClaim);

    // Add notification
    db.notifications[userId].push({
      id: "notif_rew_" + crypto.randomUUID(),
      userId,
      title: "Reward Claimed!",
      message: `Congratulations! You claimed: "${targetRew.name}". Code: ${claimCode}. points remaining: ${user.points}`,
      type: "success",
      read: false,
      timestamp: new Date().toISOString()
    });

    saveDB();
    res.json({ user, claim: newClaim });
  });

  // Subscription: Upgrade
  app.post("/api/subscription/upgrade", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user.id;
    db.users[userId].plan = "premium";
    db.users[userId].freeCompletionsRemaining = 99999; // unlimited

    db.notifications[userId].push({
      id: "notif_sub_" + crypto.randomUUID(),
      userId,
      title: "Task Tracker Premium Activated!",
      message: "Welcome to the elite class! You now have unlimited AI completions, premium insights, and priority queue support.",
      type: "success",
      read: false,
      timestamp: new Date().toISOString()
    });

    saveDB();
    res.json({ user: db.users[userId] });
  });


  // --- FRONTEND ROUTING & VITE MIDDLEWARE ---

  if (process.env.NODE_ENV !== "production") {
    // Development Mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    // Production Mode
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express server running on http://localhost:${PORT}`);
  });
}

startServer();
