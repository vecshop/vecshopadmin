require("dotenv").config();
const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");

const app = express();
const port = process.env.PORT || 3000;

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "src/public")));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err.stack);
  res.status(500).json({
    error: "Internal Server Error",
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Something went wrong",
  });
});

// Health check endpoint for Vercel
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Leaderboard endpoint
app.get("/api/leaderboard", async (req, res) => {
  try {
    // Get registered users
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, full_name, points, exp, display_id")
      .order("exp", { ascending: false });

    if (usersError) throw usersError;

    // Get temporary users
    const { data: tempUsers, error: tempError } = await supabase
      .from("temporary_leaderboard")
      .select("name, exp_points, display_id, class")
      .order("exp_points", { ascending: false });

    if (tempError) throw tempError;

    // Format registered users
    const formattedUsers = users.map((user) => ({
      id: user.id,
      name: user.full_name,
      points: user.points || 0,
      exp: user.exp || 0,
      display_id: user.display_id,
      source: "user",
    }));

    // Format temporary users
    const formattedTempUsers = tempUsers.map((user) => ({
      name: user.name,
      points: 0,
      exp: user.exp_points || 0,
      display_id: user.display_id,
      class: user.class,
      source: "temporary",
    }));

    // Combine and sort by exp
    const combined = [...formattedUsers, ...formattedTempUsers].sort(
      (a, b) => b.exp - a.exp
    );

    res.json({
      success: true,
      data: combined,
    });
  } catch (error) {
    console.error("Leaderboard error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch leaderboard data",
    });
  }
});

// Add EXP endpoint
app.post("/api/admin/add-exp", async (req, res) => {
  try {
    const { user_id, display_id, exp_amount } = req.body;

    if (!exp_amount || exp_amount < 1) {
      return res.status(400).json({
        success: false,
        error: "Invalid EXP amount",
      });
    }

    if (user_id) {
      // Handle registered user
      const { data, error } = await supabase.rpc("increment_exp", {
        row_id: user_id,
        increment_amount: exp_amount,
      });

      if (error) throw error;

      res.json({
        success: true,
        new_exp: data,
      });
    } else if (display_id) {
      // Handle temporary user
      const { data, error } = await supabase.rpc("increment_temp_exp", {
        temp_id: display_id,
        increment_amount: exp_amount,
      });

      if (error) throw error;

      res.json({
        success: true,
        new_exp: data,
      });
    } else {
      res.status(400).json({
        success: false,
        error: "Missing user_id or display_id",
      });
    }
  } catch (error) {
    console.error("Add EXP error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Reduce EXP endpoint
app.post("/api/admin/reduce-exp", async (req, res) => {
  try {
    const { user_id, display_id, exp_amount } = req.body;

    if (!exp_amount || exp_amount < 1) {
      return res.status(400).json({
        success: false,
        error: "Invalid EXP amount",
      });
    }

    if (user_id) {
      // Handle registered user
      const { data, error } = await supabase.rpc("increment_exp", {
        row_id: user_id,
        increment_amount: -exp_amount,
      });

      if (error) throw error;

      res.json({
        success: true,
        new_exp: data,
      });
    } else if (display_id) {
      // Handle temporary user
      const { data, error } = await supabase.rpc("increment_temp_exp", {
        temp_id: display_id,
        increment_amount: -exp_amount,
      });

      if (error) throw error;

      res.json({
        success: true,
        new_exp: data,
      });
    } else {
      res.status(400).json({
        success: false,
        error: "Missing user_id or display_id",
      });
    }
  } catch (error) {
    console.error("Reduce EXP error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

const server = app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// WebSocket setup with better error handling
const wss = new WebSocket.Server({
  server,
  path: "/ws",
  verifyClient: (info, cb) => {
    // Accept all connections
    cb(true);
  },
  clientTracking: true // Enable built-in client tracking
});

// Connection handling
wss.on("connection", (ws, req) => {
  console.log("Client connected");
  
  // Send initial connection success message
  ws.send(JSON.stringify({
    type: "connection",
    status: "connected"
  }));

  // Keep connection alive with ping/pong
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 30000);

  ws.on("pong", () => {
    // Client is still alive
  });

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);
      // Handle messages
      console.log("Received:", data);
    } catch (error) {
      console.error("WebSocket message error:", error);
      ws.send(JSON.stringify({ 
        type: "error",
        message: "Invalid message format"
      }));
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    clearInterval(pingInterval);
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

// Handle server shutdown
process.on("SIGTERM", () => {
  wss.close(() => {
    console.log("WebSocket server closed");
    process.exit(0);
  });
});
