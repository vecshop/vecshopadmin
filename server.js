const express = require("express");
const path = require("path");
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

// Add after other requires
const WebSocket = require("ws");
const http = require("http");

const app = express();

// Create src/public directory structure
const publicPath = path.join(__dirname, "src", "public");

// Ensure directories exist
["js", "css"].forEach((dir) => {
  const dirPath = path.join(publicPath, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

// Basic error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

// Serve static files - ensure directory exists first
app.use(express.static(publicPath));
app.use(express.json());

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Tambahkan di awal file setelah koneksi Supabase
const supabaseClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    realtime: true,
    db: {
      schema: "public",
    },
  }
);

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({
  server,
  path: "/ws",
});

// Add WebSocket authentication
wss.on("connection", (ws, req) => {
  try {
    const params = new URLSearchParams(req.url.split("?")[1]);
    const token = params.get("token");

    if (!token) {
      ws.close(1008, "Authorization Required");
      return;
    }

    // Validate token
    supabase.auth
      .getUser(token)
      .then(({ data: { user } }) => {
        if (!user) {
          ws.close(1008, "Invalid Token");
          return;
        }

        ws.userId = user.id; // Store user ID in ws instance
        setupNotificationChannel(ws, user.id);
      })
      .catch((error) => {
        console.error("Auth error:", error);
        ws.close(1008, "Authentication Failed");
      });
  } catch (error) {
    console.error("Connection error:", error);
    ws.close(1011, "Internal Server Error");
  }
});

function setupNotificationChannel(ws, userId) {
  const channel = supabaseClient
    .channel(`notifications:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `send_to_user_id=eq.${userId}`,
      },
      async (payload) => {
        try {
          // Process notification
          console.log("========= Notification Debug =========");
          console.log("Raw payload received:", payload);
          console.log("Notification type:", payload.new.notif_type);
          console.log("Notification title:", payload.new.notif_title);
          console.log("Notification content:", payload.new.notif_contents);

          let thumbnail = null;
          if (payload.new.notif_type === "PRODUCT") {
            const productMatch =
              payload.new.notif_contents.match(/product_id:(\S+)/);
            if (productMatch) {
              const { data: product } = await supabase
                .from("products")
                .select("thumbnail_url")
                .eq("id", productMatch[1])
                .single();

              if (product) thumbnail = product.thumbnail_url;
            }
          }

          const notificationData = {
            type: "new_notification",
            data: {
              id: payload.new.id,
              type: payload.new.notif_type,
              title: payload.new.notif_title,
              content: payload.new.notif_contents,
              thumbnail: thumbnail,
              timestamp: payload.new.created_at,
            },
          };

          console.log("Formatted data to send:", notificationData);

          // Send only to specific user's websocket
          if (ws.readyState === WebSocket.OPEN && ws.userId === userId) {
            console.log(`Sending notification to user ${userId}`);
            ws.send(JSON.stringify(notificationData));
          }
        } catch (error) {
          console.error("Error processing notification:", error);
          console.error("Error stack:", error.stack);
        }
      }
    )
    .subscribe((status) => {
      console.log(`Channel status for user ${userId}:`, status);
      if (status === "SUBSCRIBED") {
        console.log(`Notifications enabled for user ${userId}`);
      }
    });

  ws.channel = channel; // Store channel reference

  ws.on("close", () => {
    console.log(`Client ${userId} disconnected`);
    channel.unsubscribe();
  });
}

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// API Routes - letakkan semua API endpoints di sini
app.get("/api/test", async (req, res) => {
  try {
    // Test connection with more specific error handling
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .limit(1)
      .single();

    if (error) {
      console.error("Supabase Error:", error);
      throw error;
    }

    res.json({
      success: true,
      message: "Connection successful",
      data,
    });
  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
      hint: "Make sure 'users' table exists in Supabase",
    });
  }
});

app.post("/api/signup", async (req, res) => {
  try {
    const { display_name, email, password, gender, birth_date } = req.body;

    // First, create auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name,
        },
      },
    });

    if (authError) throw authError;

    // Then, create user record in users table
    const { error: dbError } = await supabase.from("users").insert([
      {
        id: authData.user.id,
        email,
        full_name: display_name,
        gender,
        birth_date,
        points: 0,
        exp: 0,
        rank: "BRONZE",
      },
    ]);

    if (dbError) throw dbError;

    res.json({
      success: true,
      message: "Sign up successful",
      token: authData.session.access_token, // Add this line
    });
  } catch (error) {
    console.error("Signup Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.get("/api/user/me", async (req, res) => {
  try {
    // Get session from request header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "No authorization header",
      });
    }

    // Get user session
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

    if (authError) throw authError;

    // Get user data from users table
    const { data: userData, error: dbError } = await supabase
      .from("users")
      .select("*")
      .eq("id", user.id)
      .single();

    if (dbError) throw dbError;

    res.json({
      success: true,
      data: userData,
    });
  } catch (error) {
    console.error("User data error:", error);
    res.status(401).json({
      success: false,
      message: error.message,
    });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (authError) throw authError;

    res.json({
      success: true,
      message: "Login successful",
      token: authData.session.access_token,
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(401).json({
      success: false,
      message: "Invalid email or password",
    });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const { data: products, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data: products,
    });
  } catch (error) {
    console.error("Products Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Add this with other API routes
app.post("/api/cart/add", async (req, res) => {
  try {
    const { product_id, variant_id, buy_quantity } = req.body;

    // Get user from auth token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "No authorization header",
      });
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError) throw userError;

    // Check if item already exists in cart
    const { data: existingItem, error: checkError } = await supabase
      .from("my_cart")
      .select("*")
      .eq("user_id", user.id)
      .eq("variant_id", variant_id)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      // PGRST116 means no rows returned
      throw checkError;
    }

    if (existingItem) {
      // Update existing cart item
      const newQuantity = existingItem.buy_quantity + buy_quantity;

      // Get rewards per unit
      const rewardsPerUnit = {
        point_reward: Math.floor(
          existingItem.point_reward / existingItem.buy_quantity
        ),
        exp_reward: Math.floor(
          existingItem.exp_reward / existingItem.buy_quantity
        ),
      };

      // Update quantity and rewards
      const { data: updatedItem, error: updateError } = await supabase
        .from("my_cart")
        .update({
          buy_quantity: newQuantity,
          point_reward: rewardsPerUnit.point_reward * newQuantity,
          exp_reward: rewardsPerUnit.exp_reward * newQuantity,
        })
        .eq("id", existingItem.id)
        .select()
        .single();

      if (updateError) throw updateError;

      res.json({
        success: true,
        message: "Cart item updated",
        data: updatedItem,
      });
      return;
    }

    // If item doesn't exist, get variant data
    const { data: variant, error: variantError } = await supabase
      .from("product_variants")
      .select(
        `
                variant_type,
                variant_name,
                variant_thumbnail,
                price,
                point_reward,
                exp_reward
            `
      )
      .eq("id", variant_id)
      .single();

    if (variantError) throw variantError;

    // Insert new cart item
    const { data: newItem, error: insertError } = await supabase
      .from("my_cart")
      .insert([
        {
          user_id: user.id,
          product_id,
          variant_id,
          cart_variant_type: variant.variant_type,
          cart_variant_name: variant.variant_name,
          cart_variant_thumbnail: variant.variant_thumbnail,
          buy_quantity,
          price: variant.price,
          point_reward: variant.point_reward * buy_quantity,
          exp_reward: variant.exp_reward * buy_quantity,
        },
      ])
      .select()
      .single();

    if (insertError) throw insertError;

    res.json({
      success: true,
      message: "Item added to cart",
      data: newItem,
    });
  } catch (error) {
    console.error("Add to cart error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.put("/api/cart/update/:id", async (req, res) => {
  try {
    const { buy_quantity } = req.body;
    const cartItemId = req.params.id;

    // Get user from auth token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "No authorization header",
      });
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError) throw userError;

    // First get the current cart item to get original rewards per unit
    const { data: currentItem, error: fetchError } = await supabase
      .from("my_cart")
      .select("*")
      .eq("id", cartItemId)
      .eq("user_id", user.id)
      .single();

    if (fetchError) throw fetchError;

    // Calculate new rewards based on quantity
    const rewardsPerUnit = {
      point_reward: Math.floor(
        currentItem.point_reward / currentItem.buy_quantity
      ),
      exp_reward: Math.floor(currentItem.exp_reward / currentItem.buy_quantity),
    };

    // Update cart item with new quantity and recalculated rewards
    const { data, error } = await supabase
      .from("my_cart")
      .update({
        buy_quantity: buy_quantity,
        point_reward: rewardsPerUnit.point_reward * buy_quantity,
        exp_reward: rewardsPerUnit.exp_reward * buy_quantity,
      })
      .eq("id", cartItemId)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data: data,
    });
  } catch (error) {
    console.error("Update cart error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    // Log the requested ID
    console.log("Fetching product ID:", req.params.id);

    // Validate UUID format
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        req.params.id
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID format",
      });
    }

    const { data: product, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", req.params.id)
      .single();

    // Log the result
    console.log("Query result:", { product, error });

    if (error) throw error;
    if (!product) throw new Error("Product not found");

    res.json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("Product Error:", error);
    res.status(error.message === "Product not found" ? 404 : 500).json({
      success: false,
      message: error.message,
    });
  }
});

// Add this to server.js with other API routes
app.get("/api/products/:id/variants", async (req, res) => {
  try {
    const { data: variants, error } = await supabase
      .from("product_variants")
      .select("*")
      .eq("product_id", req.params.id)
      .order("variant_type", { ascending: true });

    if (error) throw error;

    res.json({
      success: true,
      data: variants,
    });
  } catch (error) {
    console.error("Variants Error:", error);
    res.status(404).json({
      success: false,
      message: "Variants not found",
    });
  }
});

app.get("/api/cart/count", async (req, res) => {
  try {
    // Get user from auth token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "No authorization header",
      });
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError) throw userError;

    // Get count for specific user
    const { count, error } = await supabase
      .from("my_cart")
      .select("*", { count: "exact" })
      .eq("user_id", user.id);

    if (error) throw error;

    res.json({
      success: true,
      count: count || 0,
    });
  } catch (error) {
    console.error("Cart count error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Update the /api/leaderboard endpoint
app.get("/api/leaderboard", async (req, res) => {
  try {
    const { data: tempLeaderboard, error: tempError } = await supabase
      .from("temporary_leaderboard")
      .select("id, name, exp_points, display_id, class")
      .order("exp_points", { ascending: false });

    if (tempError) throw tempError;

    // Add points selection for users
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, full_name, exp, display_id, points") // Added points field
      .order("exp", { ascending: false });

    if (usersError) throw usersError;

    const tempData = tempLeaderboard.map((item) => ({
      id: item.id,
      name: item.name,
      exp: item.exp_points,
      display_id: item.display_id,
      class: item.class,
      points: null, // No points for temporary users
      source: "temporary",
    }));

    const userData = users.map((user) => ({
      id: user.id,
      name: user.full_name,
      exp: user.exp,
      display_id: user.display_id,
      points: user.points, // Include points for registered users
      source: "user",
    }));

    const combinedData = [...tempData, ...userData].sort(
      (a, b) => b.exp - a.exp
    );

    res.json({
      success: true,
      data: combinedData,
    });
  } catch (error) {
    console.error("Leaderboard Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Add this to server.js
app.get("/api/cart/items", async (req, res) => {
  try {
    // Get user from auth token
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "No authorization header",
      });
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError) throw userError;

    // Get cart items with product details for specific user
    const { data: cartItems, error: cartError } = await supabase
      .from("my_cart")
      .select(
        `
                *,
                products:product_id (
                    name,
                    thumbnail_url
                )
            `
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (cartError) throw cartError;

    res.json({
      success: true,
      data: cartItems,
    });
  } catch (error) {
    console.error("Cart items error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Add these new endpoints
app.get("/api/notifications", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "No authorization header" });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

    if (authError) throw authError;

    console.log("Fetching notifications for user:", user.id); // Debug log

    const { data: notifications, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("send_to_user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    console.log("Found notifications:", notifications); // Debug log

    res.json({ notifications: notifications || [] });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/notifications/:id/read", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "No authorization header" });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

    if (authError) throw authError;

    const { error } = await supabase
      .from("notifications")
      .update({ status: "READ" })
      .eq("id", req.params.id)
      .eq("send_to_user_id", user.id);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({ error: error.message });
  }
});

// Add this new endpoint
app.get("/api/notifications/unread/count", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "No authorization header" });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

    if (authError) throw authError;

    // Get count of unread notifications
    const { count, error } = await supabase
      .from("notifications")
      .select("*", { count: "exact" })
      .eq("send_to_user_id", user.id)
      .eq("status", "UNREAD");

    if (error) throw error;

    res.json({
      success: true,
      count: count || 0,
    });
  } catch (error) {
    console.error("Error getting unread count:", error);
    res.status(500).json({ error: error.message });
  }
});

// Add these new endpoints
app.get("/api/addresses", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "No authorization header" });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

    if (authError) throw authError;

    const { data: addresses, error } = await supabase
      .from("user_address")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({ addresses: addresses || [] });
  } catch (error) {
    console.error("Error fetching addresses:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/addresses", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "No authorization header" });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

    if (authError) throw authError;

    const { alamat_lengkap, patokan, jenis_alamat } = req.body;

    // First, set all existing addresses to UNUSED
    await supabase
      .from("user_address")
      .update({ status: "UNUSED" })
      .eq("user_id", user.id);

    // Then add new address as USED
    const { data: address, error } = await supabase
      .from("user_address")
      .insert([
        {
          user_id: user.id,
          alamat_lengkap,
          patokan,
          jenis_alamat,
          status: "USED",
        },
      ])
      .select()
      .single();

    if (error) throw error;

    res.json({ address });
  } catch (error) {
    console.error("Error adding address:", error);
    res.status(500).json({ error: error.message });
  }
});

// Add to server.js
app.put("/api/addresses/:id/select", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "No authorization header" });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

    if (authError) throw authError;

    // First, set all addresses to UNUSED
    await supabase
      .from("user_address")
      .update({ status: "UNUSED" })
      .eq("user_id", user.id);

    // Then set selected address to USED
    const { error } = await supabase
      .from("user_address")
      .update({ status: "USED" })
      .eq("id", req.params.id)
      .eq("user_id", user.id);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error("Error selecting address:", error);
    res.status(500).json({ error: error.message });
  }
});

// Add to server.js
app.delete("/api/cart/delete-multiple", async (req, res) => {
  try {
    const { itemIds } = req.body;

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "No authorization header" });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

    if (authError) throw authError;

    // Delete multiple items
    const { error } = await supabase
      .from("my_cart")
      .delete()
      .in("id", itemIds)
      .eq("user_id", user.id);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error("Delete cart items error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Add this new endpoint after the add-exp endpoint
app.get("/api/payment-methods", async (req, res) => {
  try {
    const { data: paymentMethods, error } = await supabase
      .from("payment_method")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data: paymentMethods,
    });
  } catch (error) {
    console.error("Error fetching payment methods:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Add to server.js
app.post("/api/orders", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "No authorization header" });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

    if (authError) throw authError;

    // Add user_id to order data
    const orderData = {
      ...req.body,
      user_id: user.id,
      created_at: new Date().toISOString(),
    };

    // Insert order
    const { data: order, error } = await supabase
      .from("orders")
      .insert([orderData])
      .select()
      .single();

    if (error) throw error;

    // Create notification for new order
    await supabase.from("notifications").insert([
      {
        send_to_user_id: user.id,
        notif_type: "ORDER",
        notif_title: "Order Received",
        notif_contents: `Your order #${order.id} has been received and is being processed.`,
        status: "UNREAD",
      },
    ]);

    res.json({
      success: true,
      order: order,
    });
  } catch (error) {
    console.error("Create order error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Add new bulk orders endpoint
app.post("/api/orders/bulk", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "No authorization header" });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

    if (authError) throw authError;

    const { orders, cartItemIds } = req.body; // Add cartItemIds to request body

    // Add user_id, created_at and determine status for each order
    const ordersWithUser = orders.map((order) => {
      const status =
        order.payment_detail.method_id ===
        "ecd09068-bebe-48ff-b834-9e4932619fa0"
          ? "pending"
          : "payment";

      return {
        ...order,
        user_id: user.id,
        created_at: new Date().toISOString(),
        status: status,
      };
    });

    // Insert all orders
    const { data: createdOrders, error } = await supabase
      .from("orders")
      .insert(ordersWithUser)
      .select();

    if (error) {
      console.error("Create bulk orders error:", error);
      throw error;
    }

    // Delete the ordered items from cart
    if (cartItemIds && cartItemIds.length > 0) {
      const { error: deleteError } = await supabase
        .from("my_cart")
        .delete()
        .in("id", cartItemIds)
        .eq("user_id", user.id);

      if (deleteError) {
        console.error("Error deleting cart items:", deleteError);
        // Don't throw error here to ensure order creation succeeds
      }
    }

    // Create notification for bulk order
    await supabase.from("notifications").insert([
      {
        send_to_user_id: user.id,
        notif_type: "ORDER",
        notif_title: "Orders Received",
        notif_contents: `Your ${orders.length} orders have been received and are being processed.`,
        status: "UNREAD",
      },
    ]);

    res.json({
      success: true,
      orders: createdOrders,
    });
  } catch (error) {
    console.error("Create bulk orders error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Add these new endpoints
app.get("/api/services/categories", async (req, res) => {
  try {
    // Select distinct categories from services table
    const { data, error } = await supabase
      .from("services")
      .select("category")
      .not("category", "is", null) // Filter out null categories
      .order("category"); // Order alphabetically

    if (error) throw error;

    // Extract unique categories
    const uniqueCategories = [...new Set(data.map((item) => item.category))];

    res.json({
      success: true,
      categories: uniqueCategories,
    });
  } catch (error) {
    console.error("Categories Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.get("/api/services", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("services")
      .select(
        `
        id,
        service_name,
        description,
        service_features,
        thumbnail_url,
        price_calculation,
        category,
        exp_reward,
        point_reward,
        created_at
      `
      )
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data: data,
    });
  } catch (error) {
    console.error("Services Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Add with other API routes
app.get("/api/banners", async (req, res) => {
  try {
    const { data: banners, error } = await supabase
      .from("banners")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data: banners,
    });
  } catch (error) {
    console.error("Banners Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.post("/api/admin/add-exp", async (req, res) => {
  try {
    const { user_id, display_id, exp_amount } = req.body;
    console.log("Add EXP request:", { user_id, display_id, exp_amount });

    // Input validation
    if (!exp_amount || exp_amount < 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid exp_amount",
      });
    }

    // Auth validation
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "No authorization header",
      });
    }

    // For registered users (has UUID)
    if (user_id) {
      console.log("Processing registered user:", user_id);

      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("id, full_name, exp")
        .eq("id", user_id)
        .single();

      if (userError) {
        console.error("User fetch error:", userError);
        return res.status(404).json({
          success: false,
          message: "Registered user not found",
        });
      }

      // Update user exp
      const { data: updateData, error: updateError } = await supabase
        .from("users")
        .update({
          exp: (userData.exp || 0) + exp_amount,
        })
        .eq("id", user_id)
        .select()
        .single();

      if (updateError) {
        console.error("Update error:", updateError);
        throw updateError;
      }

      return res.json({
        success: true,
        message: "EXP added successfully to registered user",
        data: updateData,
      });
    }

    // For temporary users (has display_id)
    if (display_id) {
      console.log("Processing temporary user:", display_id);

      const { data: tempData, error: tempError } = await supabase
        .from("temporary_leaderboard")
        .select("id, name, exp_points")
        .eq("display_id", display_id)
        .single();

      if (tempError) {
        console.error("Temp user fetch error:", tempError);
        return res.status(404).json({
          success: false,
          message: "Temporary user not found",
        });
      }

      // Update temporary user exp
      const { data: updateData, error: updateError } = await supabase
        .from("temporary_leaderboard")
        .update({
          exp_points: (tempData.exp_points || 0) + exp_amount,
        })
        .eq("display_id", display_id)
        .select()
        .single();

      if (updateError) {
        console.error("Update error:", updateError);
        throw updateError;
      }

      return res.json({
        success: true,
        message: "EXP added successfully to temporary user",
        data: updateData,
      });
    }

    return res.status(400).json({
      success: false,
      message: "Either user_id or display_id must be provided",
    });
  } catch (error) {
    console.error("Add EXP Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Add this new endpoint after the add-exp endpoint
app.post("/api/admin/add-points", async (req, res) => {
  try {
    const { user_id, points_amount } = req.body;
    console.log("Add Points request:", { user_id, points_amount });

    // Input validation
    if (!points_amount || points_amount < 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid points_amount",
      });
    }

    // Auth validation
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "No authorization header",
      });
    }

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Get and update user points
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id, full_name, points")
      .eq("id", user_id)
      .single();

    if (userError) {
      console.error("User fetch error:", userError);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Update user points
    const { data: updateData, error: updateError } = await supabase
      .from("users")
      .update({
        points: (userData.points || 0) + points_amount,
      })
      .eq("id", user_id)
      .select()
      .single();

    if (updateError) {
      console.error("Update error:", updateError);
      throw updateError;
    }

    return res.json({
      success: true,
      message: "Points added successfully",
      data: updateData,
    });
  } catch (error) {
    console.error("Add Points Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Add this new endpoint after the add-points endpoint
app.post("/api/admin/reduce-exp", async (req, res) => {
  try {
    const { user_id, display_id, exp_amount } = req.body;
    console.log("Reduce EXP request:", { user_id, display_id, exp_amount });

    // Input validation
    if (!exp_amount || exp_amount < 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid exp_amount",
      });
    }

    // Auth validation
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "No authorization header",
      });
    }

    // For registered users (has UUID)
    if (user_id) {
      console.log("Processing registered user:", user_id);

      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("id, full_name, exp")
        .eq("id", user_id)
        .single();

      if (userError) {
        console.error("User fetch error:", userError);
        return res.status(404).json({
          success: false,
          message: "Registered user not found",
        });
      }

      // Calculate new exp (prevent negative values)
      const newExp = Math.max(0, (userData.exp || 0) - exp_amount);

      // Update user exp
      const { data: updateData, error: updateError } = await supabase
        .from("users")
        .update({
          exp: newExp,
        })
        .eq("id", user_id)
        .select()
        .single();

      if (updateError) {
        console.error("Update error:", updateError);
        throw updateError;
      }

      return res.json({
        success: true,
        message: "EXP reduced successfully for registered user",
        data: updateData,
      });
    }

    // For temporary users (has display_id)
    if (display_id) {
      console.log("Processing temporary user:", display_id);

      const { data: tempData, error: tempError } = await supabase
        .from("temporary_leaderboard")
        .select("id, name, exp_points")
        .eq("display_id", display_id)
        .single();

      if (tempError) {
        console.error("Temp user fetch error:", tempError);
        return res.status(404).json({
          success: false,
          message: "Temporary user not found",
        });
      }

      // Calculate new exp (prevent negative values)
      const newExp = Math.max(0, (tempData.exp_points || 0) - exp_amount);

      // Update temporary user exp
      const { data: updateData, error: updateError } = await supabase
        .from("temporary_leaderboard")
        .update({
          exp_points: newExp,
        })
        .eq("display_id", display_id)
        .select()
        .single();

      if (updateError) {
        console.error("Update error:", updateError);
        throw updateError;
      }

      return res.json({
        success: true,
        message: "EXP reduced successfully for temporary user",
        data: updateData,
      });
    }

    return res.status(400).json({
      success: false,
      message: "Either user_id or display_id must be provided",
    });
  } catch (error) {
    console.error("Reduce EXP Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Add this new endpoint after the reduce-exp endpoint
app.post("/api/admin/reduce-points", async (req, res) => {
  try {
    const { user_id, points_amount } = req.body;
    console.log("Reduce Points request:", { user_id, points_amount });

    // Input validation
    if (!points_amount || points_amount < 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid points_amount",
      });
    }

    // Auth validation
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "No authorization header",
      });
    }

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Get and update user points
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id, full_name, points")
      .eq("id", user_id)
      .single();

    if (userError) {
      console.error("User fetch error:", userError);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Calculate new points (prevent negative values)
    const newPoints = Math.max(0, (userData.points || 0) - points_amount);

    // Update user points
    const { data: updateData, error: updateError } = await supabase
      .from("users")
      .update({
        points: newPoints,
      })
      .eq("id", user_id)
      .select()
      .single();

    if (updateError) {
      console.error("Update error:", updateError);
      throw updateError;
    }

    return res.json({
      success: true,
      message: "Points reduced successfully",
      data: updateData,
    });
  } catch (error) {
    console.error("Reduce Points Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});
// Page Routes
app.get("/signup", (req, res) => {
  res.sendFile(path.join(publicPath, "signup.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(publicPath, "login.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

// Add this with other page routes in server.js
app.get("/my-cart.html", (req, res) => {
  res.sendFile(path.join(publicPath, "my-cart.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(publicPath, "admin.html"));
});

// Add to page routes
app.get("/thank-you.html", (req, res) => {
  res.sendFile(path.join(publicPath, "thank-you.html"));
});

// Add with other page routes
app.get("/allProducts.html", (req, res) => {
  res.sendFile(path.join(publicPath, "allProducts.html"));
});

// Catch-all route - harus selalu di paling bawah
app.get("*", (req, res) => {
  res.redirect("/");
});

const PORT = process.env.PORT || 3000;

// Start server with error handling
server
  .listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  })
  .on("error", (err) => {
    console.error("Server failed to start:", err);
  });
