const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const mysql = require("mysql2/promise");

const app = express();

const PORT = process.env.PORT || 8080;
const DB_HOST = process.env.DB_HOST || "localhost";
const DB_USER = process.env.DB_USER || "root";
const DB_PASSWORD = process.env.DB_PASSWORD || "";
const DB_NAME = process.env.DB_NAME || "grabiii_db";

const ORDER_STATUSES = [
  "Pending",
  "Preparing",
  "Ready",
  "Completed",
  "Cancelled"
];

let pool = null;
let useMemoryDb = false;

const seedProducts = [
  {
    id: "p1",
    name: "Classic Burger",
    category: "Burgers",
    price: 129,
    description: "Juicy beef patty, cheese, lettuce and special sauce.",
    emoji: "🍔",
    available: true
  },
  {
    id: "p2",
    name: "Crispy Chicken",
    category: "Chicken",
    price: 159,
    description: "Crunchy golden chicken with a savory dip.",
    emoji: "🍗",
    available: true
  },
  {
    id: "p3",
    name: "Pepperoni Pizza",
    category: "Pizza",
    price: 299,
    description: "Cheesy pizza loaded with pepperoni.",
    emoji: "🍕",
    available: true
  },
  {
    id: "p4",
    name: "Loaded Fries",
    category: "Sides",
    price: 99,
    description: "Crispy fries topped with cheese and savory bits.",
    emoji: "🍟",
    available: true
  },
  {
    id: "p5",
    name: "Iced Cola",
    category: "Drinks",
    price: 59,
    description: "Cold, fizzy and refreshing.",
    emoji: "🥤",
    available: true
  },
  {
    id: "p6",
    name: "Chocolate Sundae",
    category: "Desserts",
    price: 89,
    description: "Creamy vanilla soft serve with chocolate drizzle.",
    emoji: "🍨",
    available: true
  }
];

let memoryProducts = seedProducts.map((p) => ({ ...p }));
let memoryOrders = [];

app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        origin === "http://localhost:5173" ||
        origin === "http://127.0.0.1:5173" ||
        origin === process.env.FRONTEND_URL ||
        origin.endsWith(".netlify.app")
      ) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

app.use(express.json());

/* ---------- Helpers ---------- */

function mapProduct(row) {
  return {
    ...row,
    price: Number(row.price),
    available: Boolean(row.available)
  };
}

function mapOrder(row) {
  let items = row.items;

  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
    } catch {
      items = [];
    }
  }

  return {
    ...row,
    items,
    total: Number(row.total)
  };
}

function generateOrderId() {
  return String(Date.now()).slice(-8);
}

/* ---------- Database ---------- */

async function initializeDatabase() {
  try {
    const sslOption =
      process.env.DB_SSL === "true"
        ? { ssl: { rejectUnauthorized: false } }
        : {};

    const connection = await mysql.createConnection({
      host: DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: DB_USER,
      password: DB_PASSWORD,
      connectTimeout: 5000,
      ...sslOption
    });

    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
    await connection.end();

    pool = mysql.createPool({
      host: DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      ...sslOption
    });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100) DEFAULT '',
        price DECIMAL(10, 2) NOT NULL DEFAULT 0,
        description TEXT,
        emoji VARCHAR(20) DEFAULT '🍽️',
        available TINYINT(1) NOT NULL DEFAULT 1
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id VARCHAR(20) PRIMARY KEY,
        customerUid VARCHAR(255) NOT NULL,
        customerName VARCHAR(255) DEFAULT 'Customer',
        customerEmail VARCHAR(255) NOT NULL,
        items JSON NOT NULL,
        total DECIMAL(10, 2) NOT NULL DEFAULT 0,
        status VARCHAR(50) NOT NULL DEFAULT 'Pending',
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const [[{ count }]] = await pool.query(
      "SELECT COUNT(*) AS count FROM products"
    );

    if (count === 0) {
      for (const p of seedProducts) {
        await pool.query(
          `INSERT INTO products
           (id, name, category, price, description, emoji, available)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            p.id,
            p.name,
            p.category,
            p.price,
            p.description,
            p.emoji,
            p.available ? 1 : 0
          ]
        );
      }
    }

    useMemoryDb = false;
    console.log(`Connected to MySQL database: ${DB_NAME}`);
  } catch (error) {
    useMemoryDb = true;
    pool = null;
    console.warn(
      "MySQL unavailable. Running in temporary in-memory mode:",
      error.message
    );
  }
}

/* ---------- Health ---------- */

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Grabiii API is running.",
    storage: useMemoryDb ? "in-memory" : "mysql"
  });
});

app.get("/api/health", async (req, res) => {
  if (useMemoryDb) {
    return res.json({
      ok: true,
      success: true,
      app: "Grabiii API",
      storage: "in-memory",
      message: "Backend is running in temporary in-memory mode (no DB)."
    });
  }

  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      success: true,
      app: "Grabiii API",
      storage: "mysql",
      message: "Backend and MySQL connection are working."
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      success: false,
      message: "Database connection failed."
    });
  }
});

/* ---------- Products ---------- */

app.get("/api/products", async (req, res) => {
  try {
    if (useMemoryDb) {
      return res.json(memoryProducts);
    }

    const [rows] = await pool.query("SELECT * FROM products");

    res.json(rows.map(mapProduct));
  } catch (error) {
    console.error("Fetch products error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to fetch products."
    });
  }
});

app.post("/api/products", async (req, res) => {
  try {
    const {
      name,
      category = "",
      price,
      description = "",
      emoji = "🍽️",
      available = true
    } = req.body;

    if (
      !name ||
      price === undefined ||
      !Number.isFinite(Number(price)) ||
      Number(price) < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Name and a valid price are required."
      });
    }

    const product = {
      id: crypto.randomUUID(),
      name: String(name).trim(),
      category: String(category).trim(),
      price: Number(price),
      description: String(description),
      emoji,
      available: Boolean(available)
    };

    if (useMemoryDb) {
      memoryProducts.push(product);

      return res.status(201).json({
        success: true,
        message: "Product created successfully.",
        product
      });
    }

    await pool.query(
      `INSERT INTO products
       (id, name, category, price, description, emoji, available)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        product.id,
        product.name,
        product.category,
        product.price,
        product.description,
        product.emoji,
        product.available ? 1 : 0
      ]
    );

    res.status(201).json({
      success: true,
      message: "Product created successfully.",
      product
    });
  } catch (error) {
    console.error("Create product error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to create product."
    });
  }
});

app.put("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;

    let existing;

    if (useMemoryDb) {
      existing = memoryProducts.find((p) => p.id === id);
    } else {
      const [rows] = await pool.query("SELECT * FROM products WHERE id = ?", [
        id
      ]);
      existing = rows[0] ? mapProduct(rows[0]) : null;
    }

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Product not found."
      });
    }

    const price = Number(req.body.price ?? existing.price);

    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid price."
      });
    }

    const updated = {
      ...existing,
      ...req.body,
      id: existing.id,
      price,
      available: Boolean(req.body.available ?? existing.available)
    };

    if (!updated.name) {
      return res.status(400).json({
        success: false,
        message: "Name is required."
      });
    }

    if (useMemoryDb) {
      const index = memoryProducts.findIndex((p) => p.id === id);
      memoryProducts[index] = updated;

      return res.json({
        success: true,
        message: "Product updated successfully.",
        product: updated
      });
    }

    await pool.query(
      `UPDATE products
       SET name = ?, category = ?, price = ?, description = ?,
           emoji = ?, available = ?
       WHERE id = ?`,
      [
        updated.name,
        updated.category ?? "",
        updated.price,
        updated.description ?? "",
        updated.emoji ?? "🍽️",
        updated.available ? 1 : 0,
        id
      ]
    );

    res.json({
      success: true,
      message: "Product updated successfully.",
      product: updated
    });
  } catch (error) {
    console.error("Update product error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to update product."
    });
  }
});

app.delete("/api/products/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (useMemoryDb) {
      const exists = memoryProducts.some((p) => p.id === id);

      if (!exists) {
        return res.status(404).json({
          success: false,
          message: "Product not found."
        });
      }

      memoryProducts = memoryProducts.filter((p) => p.id !== id);

      return res.json({
        success: true,
        message: "Product deleted successfully."
      });
    }

    const [result] = await pool.query("DELETE FROM products WHERE id = ?", [
      id
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found."
      });
    }

    res.json({
      success: true,
      message: "Product deleted successfully."
    });
  } catch (error) {
    console.error("Delete product error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to delete product."
    });
  }
});

/* ---------- Orders ---------- */

app.get("/api/orders", async (req, res) => {
  try {
    const { customerEmail } = req.query;

    if (useMemoryDb) {
      const rows = customerEmail
        ? memoryOrders.filter(
            (o) =>
              String(o.customerEmail).toLowerCase() ===
              String(customerEmail).trim().toLowerCase()
          )
        : memoryOrders;

      return res.json(
        [...rows].sort(
          (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        )
      );
    }

    let sql = "SELECT * FROM orders";
    const values = [];

    if (customerEmail) {
      sql += " WHERE customerEmail = ?";
      values.push(String(customerEmail).trim());
    }

    sql += " ORDER BY createdAt DESC, id DESC";

    const [rows] = await pool.query(sql, values);

    res.json(rows.map(mapOrder));
  } catch (error) {
    console.error("Fetch orders error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to fetch orders."
    });
  }
});

app.get("/api/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (useMemoryDb) {
      const found = memoryOrders.find((o) => o.id === id);

      if (!found) {
        return res.status(404).json({
          success: false,
          message: "Order not found."
        });
      }

      return res.json(found);
    }

    const [rows] = await pool.query("SELECT * FROM orders WHERE id = ?", [id]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found."
      });
    }

    res.json(mapOrder(rows[0]));
  } catch (error) {
    console.error("Fetch order error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to fetch order."
    });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const { customerUid, customerName, customerEmail, items, total } =
      req.body;

    if (
      !customerUid ||
      !customerEmail ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Customer and items are required."
      });
    }

    const order = {
      id: generateOrderId(),
      customerUid: String(customerUid).trim(),
      customerName: customerName || "Customer",
      customerEmail: String(customerEmail).trim(),
      items,
      total: Number(total) || 0,
      status: "Pending",
      createdAt: new Date().toISOString()
    };

    if (useMemoryDb) {
      memoryOrders.push(order);

      return res.status(201).json({
        success: true,
        message: "Order created successfully.",
        order
      });
    }

    await pool.query(
      `INSERT INTO orders
       (id, customerUid, customerName, customerEmail, items, total, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        order.id,
        order.customerUid,
        order.customerName,
        order.customerEmail,
        JSON.stringify(order.items),
        order.total,
        order.status
      ]
    );

    const [rows] = await pool.query("SELECT * FROM orders WHERE id = ?", [
      order.id
    ]);

    res.status(201).json({
      success: true,
      message: "Order created successfully.",
      order: mapOrder(rows[0])
    });
  } catch (error) {
    console.error("Create order error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to create order."
    });
  }
});

app.put("/api/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid order status."
      });
    }

    if (useMemoryDb) {
      const index = memoryOrders.findIndex((o) => o.id === id);

      if (index === -1) {
        return res.status(404).json({
          success: false,
          message: "Order not found."
        });
      }

      memoryOrders[index] = { ...memoryOrders[index], status };

      return res.json({
        success: true,
        message: "Order status updated successfully.",
        order: memoryOrders[index]
      });
    }

    const [result] = await pool.query(
      "UPDATE orders SET status = ? WHERE id = ?",
      [status, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found."
      });
    }

    const [rows] = await pool.query("SELECT * FROM orders WHERE id = ?", [id]);

    res.json({
      success: true,
      message: "Order status updated successfully.",
      order: mapOrder(rows[0])
    });
  } catch (error) {
    console.error("Update order error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to update order."
    });
  }
});

app.delete("/api/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (useMemoryDb) {
      const exists = memoryOrders.some((o) => o.id === id);

      if (!exists) {
        return res.status(404).json({
          success: false,
          message: "Order not found."
        });
      }

      memoryOrders = memoryOrders.filter((o) => o.id !== id);

      return res.json({
        success: true,
        message: "Order deleted successfully."
      });
    }

    const [result] = await pool.query("DELETE FROM orders WHERE id = ?", [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found."
      });
    }

    res.json({
      success: true,
      message: "Order deleted successfully."
    });
  } catch (error) {
    console.error("Delete order error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to delete order."
    });
  }
});

/* ---------- Start ---------- */

async function startServer() {
  await initializeDatabase();

  app.listen(PORT, () => {
    console.log(`Grabiii backend running at http://localhost:${PORT}`);
  });
}

startServer();