const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const dotenv = require('dotenv');

dotenv.config();
const app = express();
const port = process.env.PORT || 3001;

// Define allowed origins with proper regex handling
const allowedOrigins = [
'http://home.therobobox.co',
'https://home.therobobox.co',
'http://ecom.therobobox.co', 
'https://ecom.therobobox.co',
'http://localhost:5173',
];

// Add regex pattern separately
const theroboboxRegex = /^https?:\/\/.*\.therobobox\.co$/;

// Configure CORS with proper origin checking
app.use(cors({
origin: (origin, callback) => {
  // Allow requests with no origin (like mobile apps or curl requests)
  if (!origin) return callback(null, true);
  
  // Check if origin matches exact domains or regex pattern
  if (allowedOrigins.includes(origin) || theroboboxRegex.test(origin)) {
    callback(null, true);
  } else {
    callback(new Error('Not allowed by CORS'));
  }
},
credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const checkOrigin = (req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    next();
  } else {
    next();
   // return res.status(403).json({ error: 'Forbidden: Invalid origin' });
  }
};
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`, req.headers);
  next();
});

const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_LIVE_ID, 
  key_secret: process.env.RAZORPAY_KEY_LIVE_SECRET, 
});

/*-- production db handles -*/

const pool = mysql.createPool({
  host: 'srv2203.hstgr.io',
  user: 'u827919021_products',
  password: 'Robobox@Parth12345',
  database: 'u827919021_Products',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});


/* -- test local mysql db handle -- */
// const pool = mysql.createPool({
//   host: 'localhost',        // Your local MySQL server
//   port: 3306,
//   user: 'root',             // Default MySQL username (change if needed)
//   password: 'root',             // Use your MySQL password if set
//   database: 'u217412984_Products', // The local database you created
//   waitForConnections: true,
//   connectionLimit: 10,
//   queueLimit: 0
// });

app.use(cors());
app.use(express.urlencoded({ extended: true }));


app.use(express.json());
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization']; 
  if (!token) return res.status(403).json({ message: 'Token not provided' });

  jwt.verify(token, '1231', (err, decoded) => {
    if (err) return res.status(401).json({ message: 'Unauthorized' });
    req.user = decoded.username;
    next();
  });
};




const upload = multer({ storage: multer.memoryStorage() });

async function initDatabase() {
  const connection = await pool.getConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        description TEXT,
        quantity INT DEFAULT 0,
        category VARCHAR(50)
      )
    `);


    await connection.query(`
     CREATE TABLE IF NOT EXISTS coupons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  discount DECIMAL(10, 2),
  discount_percent DECIMAL(5, 2),
  product_id INT,
  min_purchase DECIMAL(10, 2) DEFAULT 2000,
  FOREIGN KEY (product_id) REFERENCES products(id)
)`);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS Advert_images (
        id INT AUTO_INCREMENT PRIMARY KEY,
        image_data LONGBLOB
      )

    `)

    await connection.query(`
      CREATE TABLE IF NOT EXISTS product_images (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT,
        image_data LONGBLOB,
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id VARCHAR(255) NOT NULL,
      user VARCHAR(255),
      total_amount DECIMAL(10, 2),
      razorpay_order_id VARCHAR(255),
      razorpay_payment_id VARCHAR(255),
      address VARCHAR(255),
      phone VARCHAR(255),
      status VARCHAR(100) DEFAULT 'Processing',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )

    `);



    await connection.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id VARCHAR(255),
        product_id INT,
        quantity INT,
        price DECIMAL(10, 2),
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);



    console.log('Database initialized');
  } catch (error) {
    console.error('Error initializing database:', error);
  } finally {
    connection.release();
  }
}

initDatabase();

app.get('/api/products' ,async (req, res) => {
  try {
    const [products] = await pool.query(`
      SELECT p.*, GROUP_CONCAT(pi.id) as image_ids
      FROM products p
      LEFT JOIN product_images pi ON p.id = pi.product_id
      GROUP BY p.id
      LIMIT 100
    `);

    const productsWithImages = await Promise.all(products.map(async (product) => {
      if (product.image_ids) {
        const imageIds = product.image_ids.split(',');
        const [images] = await pool.query('SELECT id FROM product_images WHERE id IN (?)', [imageIds]);
        product.images = images.map(img => `/api/images/${img.id}`);
      } else {
        product.images = [];
      }
      delete product.image_ids;
      return product; 
    }));

    res.json(productsWithImages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
app.get('/api/products/search/:title', async (req, res) => {
  try {
    const [products] = await pool.query('SELECT p.*, GROUP_CONCAT(pi.id) as image_ids FROM products p LEFT JOIN product_images pi ON p.id = pi.product_id WHERE p.title LIKE ? GROUP BY p.id', ['%' + req.params.title + '%']);
    
    if (products.length > 0) {
      const productsWithImages = await Promise.all(products.map(async (product) => {
        if (product.image_ids) {
          const imageIds = product.image_ids.split(',');
          const [images] = await pool.query('SELECT id FROM product_images WHERE id IN (?)', [imageIds]);
          product.images = images.map(img => `/api/images/${img.id}`);
        } else {
          product.images = [];
        }
        delete product.image_ids;
        return product;
      }));

      res.json(productsWithImages);
    } else {
      res.status(404).send('Product not found');
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/images/:id', async (req, res) => {
  try {
    const [images] = await pool.query('SELECT image_data FROM product_images WHERE id = ?', [req.params.id]);
    if (images.length > 0) {
      res.contentType('image/jpeg');
      res.send(images[0].image_data);
      
    } else {
      res.status(404).send('Image not found');
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/products/:category', async (req, res) => {
  try {
    const [products] = await pool.query('SELECT * FROM products WHERE category = ?', [req.params.category]);
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/products', upload.array('images', 5),verifyToken,async (req, res) => {
  const { title, price, description, category } = req.body;
  const images = req.files;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existingProducts] = await connection.query(
      'SELECT id FROM products WHERE title = ?',
      [title]
    );

    if (existingProducts.length > 0) {
      throw new Error('A product with this title already exists');
    }

    const [result] = await connection.query(
      'INSERT INTO products (title, price, description, category) VALUES (?, ?, ?, ?)',
      [title, price, description, category]
    );

    const productId = result.insertId;

    for (const image of images) {
      await connection.query(
        'INSERT INTO product_images (product_id, image_data) VALUES (?, ?)',
        [productId, image.buffer]
      );
    }

    await connection.commit();

    res.status(201).json({
      id: productId,
      title,
      price,
      description,
      category,
      images: images.map((_, index) => `/api/images/${productId}-${index + 1}`)
    });
  } catch (error) {
    await connection.rollback();
    res.status(400).json({ message: error.message });
  } finally {
    connection.release();
  }
});


app.get('/api/product/:id', async (req, res) => {
  try {
    const [products] = await pool.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (products.length > 0) {
      const [images] = await pool.query('SELECT id FROM product_images WHERE product_id = ?', [req.params.id]);
      products[0].images = images.map(img => `/api/images/${img.id}`);
      res.json(products[0]);
    } else {
      res.status(404).send('Product not found');
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.delete('/api/products/:id',async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [product] = await connection.query('SELECT id FROM products WHERE id = ?', [req.params.id]);
    if (product.length === 0) {
      throw new Error('Product not found');
    }

    await connection.query('DELETE FROM product_images WHERE product_id = ?', [req.params.id]);
    await connection.query('DELETE FROM products WHERE id = ?', [req.params.id]);
    
    await connection.commit();

    res.status(204).end();
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ message: error.message });
  } finally {
    connection.release();
  }
});

app.patch('/api/products/:id', upload.array('images', 5),verifyToken,async (req, res) => {
  const { title, price, description, category } = req.body;
  const images = req.files;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [product] = await connection.query('SELECT id FROM products WHERE id = ?', [req.params.id]);
    if (product.length === 0) {
      throw new Error('Product not found');
    }

    if (title) await connection.query('UPDATE products SET title = ? WHERE id = ?', [title, req.params.id]);
    if (price) await connection.query('UPDATE products SET price = ? WHERE id = ?', [price, req.params.id]);
    if (description) await connection.query('UPDATE products SET description = ? WHERE id = ?', [description, req.params.id]);
    if (category) await connection.query('UPDATE products SET category = ? WHERE id = ?', [category, req.params.id]);

    if (images && images.length > 0) {
      await connection.query('DELETE FROM product_images WHERE product_id = ?', [req.params.id]);
      for (const image of images) {
        await connection.query(
          'INSERT INTO product_images (product_id, image_data) VALUES (?, ?)',
          [req.params.id, image.buffer]
        );
      }
    }
    await connection.commit();

    res.status(200).json({ id: req.params.id, title, price, description, category });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ message: error.message });
  } finally {
    connection.release();
  }
});



app.post('/api/adminlogin',async (req, res) => {
  const { username, password } = req.body;
  try {
    const adminpool = mysql.createPool({
      host: 'srv2203.hstgr.io',
      user: 'u827919021_Admin',
      database: 'u827919021_Admins',
      password: 'Robobox@Parth12345'
    });

    const [admins] = await adminpool.query('SELECT * FROM admin WHERE email = ? AND password = ?', [username, password]);
    if (admins.length > 0) {
      const token = jwt.sign({ username }, '1231', { expiresIn: '7h' });
      res.json({token });
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


app.get('/api/categories', async (req, res) => {
  try {
    const [categories] = await pool.query('SELECT * FROM Category ORDER BY id');

    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/categories', verifyToken,async (req, res) => {

  const { name } = req.body;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('INSERT INTO Category (type) VALUES (?)', [name]);
    await connection.commit();
    res.status(201).json({ name });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ message: error.message });
  } finally {
    connection.release();
  }
});


app.patch('/api/categories/:id', verifyToken,async (req, res) => {
  const { name } = req.body;
  try {
    await pool.query('UPDATE Category SET type = ? WHERE id = ?', [name, req.params.id]);
    res.status(200).json({ id: req.params.id, name });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});



app.delete('/api/categories/:id', verifyToken,async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM Category WHERE id = ?', [req.params.id]);
    await connection.commit();
    res.status(204).end();
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ message: error.message });
  } finally {
    connection.release();
  }
});



app.post('/api/processOrder', async (req, res) => {
  const { 
    razorpay_order_id, 
    razorpay_payment_id, 
    razorpay_signature,
    email,
    name,
    address,
    phone,
    items,
    appliedDiscount  
  } = req.body

  const body = razorpay_order_id + "|" + razorpay_payment_id;
  
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_LIVE_SECRET)
    .update(body.toString())
    .digest('hex');
  
  const isAuthentic = expectedSignature === razorpay_signature;

  if (!isAuthentic) {
    return res.status(400).json({ success: false, message: "Invalid signature" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let totalAmount = 0;
    const orderDetails = [];
    const orderId = `ORD${Date.now()}`;

    // Process each item in the cart
    for (const item of items) {
      const [product] = await connection.query('SELECT * FROM products WHERE id = ?', [item.productId]);
      if (!product.length) {
        throw new Error(`Product not found: ${item.productId}`);
      }

      const itemAmount = product[0].price * item.quantity;
      totalAmount += itemAmount;
      console.log("total amount before discount",totalAmount)
      totalAmount = totalAmount - (appliedDiscount / 100);
      console.log("toal amount after discount", totalAmount)

      
      
      
      
      orderDetails.push({
        title: product[0].title,
        quantity: item.quantity,
        price: product[0].price,
        amount: totalAmount
        
      });

      // Update product quantity
      await connection.query(
        'UPDATE products SET quantity = quantity - ? WHERE id = ?',
        [item.quantity, item.productId]
      );

      // Insert order item
      await connection.query(
        `INSERT INTO orders (order_id, user, total_amount, razorpay_order_id, 
          razorpay_payment_id, address, phone, applied_discount) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, email, totalAmount, razorpay_order_id, razorpay_payment_id, 
         address, phone, appliedDiscount / 100]
      );
    }

    // Insert main order
    await connection.query(
      `INSERT INTO orders (order_id, user, total_amount, razorpay_order_id, 
        razorpay_payment_id, address, phone) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [orderId, email, totalAmount, razorpay_order_id, razorpay_payment_id, address, phone]
    );

    await connection.commit();

    // Email configuration
    const transporter = nodemailer.createTransport({
      host: "smtp.hostinger.com",
      secure: true,
      tls: { ciphers: "SSLv3" },
      requireTLS: true,
      port: 465,
      debug: true,
      auth: {
        user: "orders@therobobox.co",
        pass: "Robobox@123"
      }
    });

    // Create email content
    const userEmailHtml = `
      <h1>Thank you for your purchase from The Robobox!</h1>
      <p>Dear ${name},</p>
      <p>Your order with ID ${orderId} has been successfully processed.</p>
      <h2>Order Details:</h2>
      <ul>
        ${orderDetails.map(item => `
          <li>${item.title} - Quantity: ${item.quantity}, Price: ₹${item.price}, Total: ₹${item.amount}</li>
        `).join('')}
      </ul>
      <p><strong>Total Amount: ₹${totalAmount}</strong></p>
      <p>Shipping Address: ${address}</p>
      <p>If you have any questions, please contact us.</p>
      <p>Best regards,<br>The Robobox Team</p>
    `;

    const adminEmailHtml = `
      <h1>New Order Received</h1>
      <p><strong>Order ID:</strong> ${orderId}</p>
      <p><strong>Customer Name:</strong> ${name}</p>
      <p><strong>Customer Email:</strong> ${email}</p>
      <p><strong>Customer Phone:</strong> ${phone}</p>
      <p><strong>Shipping Address:</strong> ${address}</p>
      <h2>Order Items:</h2>
      <ul>
        ${orderDetails.map(item => `
          <li>${item.title} - Quantity: ${item.quantity}, Price: ₹${item.price}, Total: ₹${item.amount}</li>
        `).join('')}
      </ul>
      <p><strong>Total Amount: ₹${totalAmount}</strong></p>
    `;

    await Promise.all([
      transporter.sendMail({
        from: "orders@therobobox.co",
        to: email,
        subject: 'Order Confirmation from The Robobox',
        html: userEmailHtml
      }),
      transporter.sendMail({
        from: "orders@therobobox.co",
        to: 'admin@therobobox.co,wearerobobox@gmail.com',
        // to: 'anupm019@gmail.com',
        subject: 'New Order Received - The Robobox',
        html: adminEmailHtml
      })
    ]);

    res.json({
      success: true,
      message: "Payment has been verified and order placed successfully",
      orderId
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error processing order:', error);
    res.status(500).json({ success: false, message: "Error processing order" });
  } finally {
    connection.release();
  }
});



app.post('/api/createBulkOrder', async (req, res) => {
  const { items, couponCode } = req.body;
  let discount = 0;

  try {
    let totalAmount = 0;
    for (const item of items) {
      const [product] = await pool.query('SELECT * FROM products WHERE id = ?', [item.productId]);
      if (!product.length) {
        return res.status(404).json({ message: `Product not found: ${item.productId}` });
      }
      totalAmount += product[0].price * item.quantity;
    }

    if (couponCode) {
      const [coupons] = await pool.query('SELECT * FROM coupons WHERE code = ?', [couponCode]);
      if (coupons.length && totalAmount >= coupons[0].min_purchase) {
        const coupon = coupons[0];
        const fixedDiscount = coupon.discount || 0;
        const percentDiscount = coupon.discount_percent ? (totalAmount * coupon.discount_percent / 100) : 0;

        discount = Math.max(fixedDiscount, percentDiscount);
        totalAmount -= discount;
      }
    }

    const amount = totalAmount * 100;
    const options = {
      amount,
      currency: 'INR',
      receipt: `receipt_bulk_order_${Date.now()}`,
      payment_capture: 1,
      notes: { seller: 'robobox', items: JSON.stringify(items), discount }
    };
    const order = await razorpayInstance.orders.create(options);

    res.json({
      id: order.id,
      currency: order.currency,
      amount: order.amount,
      discount
    });
  } catch (error) {
    console.error('Error creating bulk order:', error);
    res.status(500).json({ message: error.message });
  }
});


app.post('/api/freeclaim', async (req, res) => {
const { name, email, mobile,school, division , classna , rollNo} = req.body;
console.log('Claim request received:', req.body);
const transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com",
  secure: true,
  tls: {
    ciphers: "SSLv3",
  },
  requireTLS: true,
  port: 465,
  debug: true,
  auth: {
    user: "orders@therobobox.co",
    pass: "Robobox@123"
  }
});

const userEmailHtml = `
<div style="font-family: Arial, sans-serif; color: #333;">
  <h1 style="color: #4CAF50;">🎉 Thank you for your interest in RoboBox! 🎉</h1>
  <p>Dear ${name},</p>
  <p>✅ Your claim has been successfully submitted.</p>
  <p>🔍 We will review your claim and get back to you as soon as possible.</p>
  <p>📞 If you have any questions, please don't hesitate to contact us.</p>
  <p>Best regards,<br>The RoboBox Team 🤖</p>
  <div style="margin-top: 20px;">
    <img src="https://example.com/thank-you-image.png" alt="Thank You" style="width: 100%; max-width: 600px;"/>
  </div>
</div>
`;


const adminEmailHtml = `
<div style="font-family: Arial, sans-serif; color: #333;">
  <h1 style="color: #FF5733;">🚨 New Free Product Claim 🚨</h1>
  <p>A new free product claim has been submitted with the following details:</p>
  <p><strong>Name:</strong> ${name}</p>
  <p><strong>Email:</strong> ${email}</p>
  <p><strong>Phone:</strong> ${mobile}</p>
  <p><strong>School:</strong> ${school}</p>
  <p><strong>Division:</strong> ${division}</p>
  <p><strong>Roll NO:</strong> ${rollNo}</p>
  <p>Please review the claim and take the necessary actions.</p>
  <p>Best regards,<br>The RoboBox System 🤖</p>
</div>
`;

try {
await transporter.sendMail({
from: "orders@therobobox.co",
to: email,
subject: 'Thank You for Your Interest in RoboBox!',
html: userEmailHtml
});

await transporter.sendMail({
from: "orders@therobobox.co",
 to: 'admin@therobobox.co',
//  to: 'mishraanup266@gmail.com',
subject: 'New Free Product Claim - RoboBox',
html: adminEmailHtml
});
return res.json({ message: 'Claim submitted successfully' });

} catch (error) {
console.error('Error sending email:', error);
return res.status(500).json({ message: 'Error sending email' });
}
});


app.get('/api/ordersAdmin', verifyToken, async (req, res) => {
try {
  const [orders] = await pool.query(`
    SELECT o.*, 
           GROUP_CONCAT(DISTINCT p.title) as products,
           GROUP_CONCAT(oi.quantity) as quantities,
           GROUP_CONCAT(oi.price) as prices
    FROM orders o
    JOIN order_items oi ON o.order_id = oi.order_id
    JOIN products p ON oi.product_id = p.id
    GROUP BY o.order_id
    ORDER BY o.created_at DESC
  `);

  const formattedOrders = orders.map(order => ({
    orderId: order.order_id,
    razorpayOrderId: order.razorpay_order_id,
    razorpayPaymentId: order.razorpay_payment_id,
    customerEmail: order.user,
    customerPhone: order.phone,
    shippingAddress: order.address,
    totalAmount: order.total_amount,
    status: order.status,
    createdAt: order.created_at,
    products: order.products.split(',').map((product, index) => ({
      name: product,
      quantity: parseInt(order.quantities.split(',')[index]),
      price: parseFloat(order.prices.split(',')[index])
    }))
  }));

  res.json(formattedOrders);
} catch (error) {
  res.status(500).json({ message: error.message });
}
});







app.get('/api/UserOrders', async (req, res) => {
  const email = req.headers['email'];
  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  try {
    const [orders] = await pool.query(`
      SELECT o.*, 
             GROUP_CONCAT(DISTINCT p.title) as products,
             GROUP_CONCAT(oi.quantity) as quantities,
             GROUP_CONCAT(oi.price) as prices,
             GROUP_CONCAT(DISTINCT (
               SELECT pi.id 
               FROM product_images pi 
               WHERE pi.product_id = oi.product_id 
               LIMIT 1
             )) as image_ids
      FROM orders o
      JOIN order_items oi ON o.order_id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      WHERE o.user = ?
      GROUP BY o.order_id
      ORDER BY o.created_at DESC
    `, [email]);

    const ordersWithDetails = orders.map(order => {
      const products = order.products.split(',');
      const quantities = order.quantities.split(',');
      const prices = order.prices.split(',');
      const imageIds = order.image_ids.split(',');

      const items = products.map((title, index) => ({
        title,
        quantity: parseInt(quantities[index]),
        price: parseFloat(prices[index]),
        image_url: `/api/images/${imageIds[index]}`
      }));

      return {
        ...order,
        items,
        image_urls: imageIds.map(id => `/api/images/${id}`)
      };
    });

    res.json({ orders: ordersWithDetails });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});



app.patch('/api/UserOrders/:id', verifyToken, async (req, res) => {
  const { status } = req.body;
  console.log('Order status:', status);
  try {
      console.log('Updating order status in database');
      await pool.query('UPDATE orders SET status = ? WHERE order_id = ?', [status, req.params.id]);
      console.log('Order status updated in database');

      if (status === 'delivered') {
          console.log('Order delivered:', req.params.id);

          const [orderRows] = await pool.query(`
              SELECT o.*, 
                     p.title AS product_title, 
                     p.price AS product_price, 
                     oi.quantity,
                     (SELECT pi.id FROM product_images pi WHERE pi.product_id = oi.product_id LIMIT 1) AS image_id
              FROM orders o
              JOIN order_items oi ON o.order_id = oi.order_id
              JOIN products p ON oi.product_id = p.id
              WHERE o.order_id = ?
          `, [req.params.id]);

          if (orderRows.length === 0) {
              console.error('No order found with id:', req.params.id);
              return res.status(404).json({ message: 'Order not found' });
          }

          const order = orderRows[0];
          const userEmail = order.user;
          const productTitle = order.product_title;
          const productPrice = order.product_price;
          const quantity = order.quantity;
          const totalAmount = parseFloat(productPrice) * parseInt(quantity);
          const imageUrl = order.image_id ? `${req.protocol}://${req.get('host')}/api/images/${order.image_id}` : '';

          console.log("User email is:", userEmail);
          console.log("Product title is:", productTitle);
          console.log("Quantity is:", quantity);
          console.log("Product price is:", productPrice);
          console.log("Total amount is:", totalAmount);
          console.log('Image url is:', imageUrl);

          const transporter = nodemailer.createTransport({
              host: "smtp.hostinger.com",
              secure: true,
              port: 465,
              debug: true,
              auth: {
                  user: "orders@therobobox.co",
                  pass: "Robobox@123"
              }
          });

          const mailOptions = {
              from: 'orders@therobobox.co',
              to: userEmail,
              subject: 'Your RoboBox Order Has Arrived! 🎉',
              text: `
                  Dear Valued Customer,

                  Great news! Your RoboBox order (ID: ${req.params.id}) has been successfully delivered.

                  Order Details:
                  - Product: ${productTitle}
                  - Quantity: ${quantity}
                  - Total Amount: ₹${totalAmount}

                  We hope you're as excited as we are about your new robotic companion!

                  If you need any assistance, our support team is always here to help.

                  Thank you for choosing RoboBox - where the future comes home!

                  Best regards,
                  The RoboBox Team
              `,
              html: `
                  <!DOCTYPE html>
                  <html lang="en">
                  <head>
                      <meta charset="UTF-8">
                      <meta name="viewport" content="width=device-width, initial-scale=1.0">
                      <title>Your RoboBox Order Has Arrived!</title>
                      <style>
                          body {
                              font-family: Arial, sans-serif;
                              line-height: 1.6;
                              color: #333;
                              max-width: 600px;
                              margin: 0 auto;
                              padding: 20px;
                          }
                          .header {
                              background-color: #4a90e2;
                              color: white;
                              padding: 20px;
                              text-align: center;
                          }
                          .logo {
                              max-width: 150px;
                              height: auto;
                          }
                          .content {
                              padding: 20px;
                          }
                          .cta-button {
                              display: inline-block;
                              background-color: #4CAF50;
                              color: white;
                              padding: 10px 20px;
                              text-decoration: none;
                              border-radius: 5px;
                              margin-top: 20px;
                          }
                          .footer {
                              background-color: #f1f1f1;
                              padding: 10px;
                              text-align: center;
                              font-size: 0.8em;
                          }
                          @media only screen and (max-width: 600px) {
                              body {
                                  padding: 10px;
                              }
                              .header {
                                  padding: 10px;
                              }
                              .logo {
                                  max-width: 100px;
                              }
                          }
                      </style>
                  </head>
                  <body>
                      <div class="header">
                          <h1>Your RoboBox Has Arrived! 🎉</h1>
                      </div>
                      <div class="content">
                          <p>Dear Valued Customer,</p>
                          <p>Great news! Your RoboBox order (ID: ${req.params.id}) has been successfully delivered.</p>
                          <img src="${imageUrl}" alt="Product Image" style="max-width: 100%; height: 500px;">
                          <h2>Order Details:</h2>
                          <ul>
                              <li>Product: ${productTitle}</li>
                              <li>Quantity: ${quantity}</li>
                              <li>Total Amount: ₹${totalAmount}</li>
                          </ul>
                          <h2>What's Next?</h2>
                          <ol>
                              <li>Unbox your RoboBox carefully</li>
                              <li>Follow the enclosed quick-start guide</li>
                              <li>Power up and enjoy your new robotic friend!</li>
                          </ol>
                          <p>We hope you're as excited as we are about your new robotic companion!</p>
                          <a href="https://ecom.therobobox.co" class="cta-button">Visit Shop</a>
                      </div>
                      <div class="footer">
                          <p>If you need any assistance, our support team is always here to help.</p>
                          <p>Thank you for choosing RoboBox - where the future comes home!</p>
                      </div>
                  </body>
                  </html>
              `
          };

          transporter.sendMail(mailOptions, (error, info) => {
              if (error) {
                  console.error('Error sending email:', error);
                  //send email to admin if user email fails 
                  const mailOptionsAdmin = {
                      from: 'orders@therobobox.co',
                      to: 'admin@therobobox.co',
                      subject: 'Email Delivery Failed',
                      text: `Failed to send order delivered email to user: ${userEmail}`
                  };
                  transporter.sendMail(mailOptionsAdmin, (error, info) => {
                      if (error) {
                          console.error('Error sending email:', error);
                      } else {
                          console.log('Email sent:', info.response);
                      }
                  });
              } else {
                  console.log('Email sent:', info.response);
              }
          });
      }

      res.status(200).json({ id: req.params.id, status });
  } catch (error) {
      console.error('Error in patch request:', error);
      res.status(500).json({ message: error.message });
  }
});


app.get('/api/advertimages', async (req, res) => {
  try {
    const [images] = await pool.query('SELECT * FROM Advert_images');
    if (images.length > 0) {
      const imageUrls = images.map(img => ({ id: img.id, url: `/api/advertimages/${img.id}` }));
      res.json(imageUrls);
    } else {
      res.status(404).send('Images not found');
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/advertimages/:id', async (req, res) => {
  try {
    const [images] = await pool.query('SELECT * FROM Advert_images where id = ?', [req.params.id]);
    if (images.length > 0) {
      res.contentType('image/jpeg');
      res.send(images[0].image_data);
    } else {
      res.status(404).send('Image not found');
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


app.post('/api/advertimages', upload.array('images', 5), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const promises = req.files.map(file => 
      connection.query('INSERT INTO Advert_images (image_data) VALUES (?)', [file.buffer])
    );
    await Promise.all(promises);
    await connection.commit();
    res.status(201).json({ message: 'Images uploaded successfully' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ message: error.message });
  } finally {
    connection.release();
  }
});

app.delete('/api/advertimages/:id', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM Advert_images WHERE id = ?', [req.params.id]);
    await connection.commit();
    res.status(204).end();
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ message: error.message });
  } finally {
    connection.release();
  }
});


app.post('/api/verifyPayment', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, productId, quantity } = req.body;

  const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_LIVE_SECRET);
  hmac.update(razorpay_order_id + '|' + razorpay_payment_id);
  const generatedSignature = hmac.digest('hex');

  if (generatedSignature === razorpay_signature) {
    try {
    
      const [result] = await pool.query('INSERT INTO orders (user, product_id, quantity, razorpay_order_id, razorpay_payment_id) VALUES (?, ?, ?, ?, ?)', 
        [email, productId, quantity, razorpay_order_id, razorpay_payment_id]);

      const transporter = nodemailer.createTransport({
        host: "smtp.hostinger.com",
        secure: true,
        secureConnection: false,
        tls: {
          ciphers: "SSLv3",
        },
        requireTLS: true,
        port: 465,
        debug: true,
        connectionTimeout: 10000,
        auth: {
          user: process.env.EMAIL_USER, 
          pass: process.env.EMAIL_PASSWORD 
        }
      });

      const mailOptionsUser = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Payment Receipt from The Robobox',
        text: `Thank you for your purchase! Your order with ID ${razorpay_order_id} has been successfully processed.`,
      html:  `<h1>Thank you for your purchase!</h1>  <p>Your order with ID ${razorpay_order_id} has been successfully processed.</p>`
      };

      await transporter.sendMail(mailOptionsUser);

      const mailOptionsAdmin = {
        from: process.env.EMAIL_USER,
        to: 'admin@therobobox.co', 
        subject: 'New Order Received',
        text: `A new order has been placed with ID ${razorpay_order_id}. Please review the order details.`,
        html : `<h1>A new order has been placed!</h1>  <p>Order ID : ${razorpay_order_id} </p>`

      };

      await transporter.sendMail(mailOptionsAdmin);

      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: error.message });
    }
  } else {
    res.status(400).json({ message: 'Invalid signature' });
  }
});




app.get('/api/studofmonth', async (req, res) => {

const pool2 = mysql.createPool({
  host: 'srv1552.hstgr.io',
  
  database: 'u217412984_student_data',
  user: 'u217412984_student_data',
  password: 'Robobox@Parth12345'
});



const connection2 = await pool2.getConnection();
try {
  connection2.beginTransaction();
  await connection2.query(`CREATE TABLE IF NOT EXISTS studofmonth (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    school VARCHAR(255) NOT NULL,
    project_discription TEXT NOT NULL,
    projectyoutube_url VARCHAR(255) NOT NULL,
    studeimage LONGBLOB NOT NULL,
    creation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);





  const [rows] = await connection2.query('SELECT * FROM studofmonth ORDER BY creation_date DESC LIMIT 1');
  if (rows.length > 0) {
    const student = rows[0];
    res.status(200).json({
      name: student.name,
      school: student.school,
      details: student.project_discription,
      image: `data:image/jpeg;base64,${student.studeimage.toString('base64')}`,
      videoId: student.projectyoutube_url.split('v=')[1],
      createdAt: student.creation_date
    });

    console.log('Student of the month found');
    console.log(student);
  } else {
    res.status(404).json({ message: 'No student of the month found' });
    console.log('No student of the month found');
}



} catch (error) {
  res.status(500).json({ message: error.message });
  console.log('Error in student of the month:', error);
} finally {
  connection2.release();
}


});



app.post('/api/studofmonth', upload.single('image'), async (req, res) => {
const { name, school, details, videoId } = req.body;
const image = req.file.buffer;
const pool2 = mysql.createPool({
  host: 'srv1552.hstgr.io',
  user: 'u217412984_student_data',
  database: 'u217412984_student_data',
  password: 'Robobox@123'
});

const connection2 = await pool2.getConnection();
try {
  connection2.beginTransaction();
  await connection2.query(`CREATE TABLE IF NOT EXISTS studofmonth (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    school VARCHAR(255) NOT NULL,
    project_discription TEXT NOT NULL,
    projectyoutube_url VARCHAR(255) NOT NULL,
    studeimage LONGBLOB NOT NULL,
    creation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

    await connection2.query('INSERT INTO studofmonth (name, school, project_discription, projectyoutube_url, studeimage) VALUES (?, ?, ?, ?, ?)', [name, school, details, videoId, image]);
    await connection2.commit();
    res.status(201).json({ message: 'Student of the month added successfully' });
    console.log('Student of the month added successfully');

  }
  catch (error) {
    res.status(500).json({ message: error.message });
    console.log('Error in student of the month:', error);
  } finally {
    connection2.release();
  }

});



app.post('/api/mailforwarder', checkOrigin, upload.array('files'), async (req, res) => {
  const { con_name, phNo, reason, message, invoice } = req.body;
  const files = req.files || [];
  let emailContent = {};

  console.log('Received reason:', reason);

  if (!reason) {
    return res.status(400).json({ error: 'Request reason is required' });
  }

  switch (reason) {
    case 'enroll-school':
      if (!con_name || !phNo || !message) {
        return res.status(400).json({ error: 'Name, contact, and message are required for school enrollment requests.' });
      }
      emailContent = {
        subject: 'School Enrollment Request',
        html: `<p><strong>User:</strong> ${con_name}</p>
               <p><strong>Contact:</strong> ${phNo}</p>
               <p><strong>Request:</strong> ${message}</p>`,
      };
      break;

    case 'Demo Request':
      if (!invoice || invoice.length < 5) {
        return res.status(400).json({ error: 'Invoice is required for demo booking' });
      }

      try {
        const isValidInvoice = await validateInvoice(invoice);
        console.log('Invoice validation result:', isValidInvoice);
        if (isValidInvoice) {
          console.log('Invoice is valid');
          emailContent = {
            subject: 'New Demo Booking Request',
            html: `<p><strong>User:</strong> ${con_name}</p>
                   <p><strong>Contact:</strong> ${phNo}</p>
                   <p><strong>Message:</strong> ${message}</p>
                   <p><strong>Invoice:</strong> ${invoice}</p>`,
          };
        } else {
          console.log('Invalid invoice');
          return res.status(400).json({ error: 'Invalid invoice' });
        }
      } catch (error) {
        console.error('Error validating invoice:', error.message);
        return res.status(500).json({ error: error.message });
      }
      break;

    case 'refund-service':
      if (!con_name || !phNo || !message) {
        return res.status(400).json({ error: 'Name, contact, and message are required for refund/service requests.' });
      }
      emailContent = {
        subject: 'Refund/Service Request',
        html: `<p><strong>User:</strong> ${con_name}</p>
               <p><strong>Contact:</strong> ${phNo}</p>
               <p><strong>Request:</strong> ${message}</p>`,
      };
      break;

    case 'others':
      if (!con_name || !phNo || !message) {
        return res.status(400).json({ error: 'Name, contact, and message are required for other requests.' });
      }
      emailContent = {
        subject: 'Other Request',
        html: `<p><strong>User:</strong> ${con_name}</p>
               <p><strong>Contact:</strong> ${phNo}</p>
               <p><strong>Request:</strong> ${message}</p>`,
      };
      break;

    default:
      return res.status(400).json({ error: 'Invalid request reason: Half data received' });
  }

  try {
    console.log('Preparing to send email');
    const transporter = nodemailer.createTransport({
      host: "smtp.hostinger.com",
      port: 465,
      secure: true,
      auth: {
        user: "admin@therobobox.co",
        pass: "Robobox@123"
      },
      tls: { ciphers: "SSLv3" }
    });

    const mailOptions = {
      from: 'admin@therobobox.co',
      to: 'admin@therobobox.co,wearerobobox@gmail.com',
      // to: 'anupm019@gmail.com',
      subject: emailContent.subject,
      html: emailContent.html,
    };

    await transporter.sendMail(mailOptions);
    console.log('Email sent successfully');
    res.send('Your request has been sent to the admin. You will be contacted soon.');
  } catch (error) {
    console.error('Error sending email:', error.message);
    res.status(500).json({ message: error.message });
  }
});








async function validateInvoice(invoice) {
  console.log('Validating invoice:', invoice);
  try {
    const lastSixDigits = invoice.slice(-6);
    console.log('Last six digits of invoice:', lastSixDigits);

    const [results] = await pool.execute(
      'SELECT * FROM orders WHERE razorpay_order_id LIKE ? OR razorpay_payment_id LIKE ?',
      [`%${lastSixDigits}`, `%${lastSixDigits}`]
    );

    console.log('Query results:', results);
    return results.length > 0;
  } catch (error) {
    console.error('Error validating invoice:', error.message);
    throw new Error('Database query failed');
  }
}

app.post('/api/verifyBulkPayment', async (req, res) => {
  const { 
    razorpay_order_id, 
    razorpay_payment_id, 
    razorpay_signature,
    email,
    address,
    phone,
    items
  } = req.body;

  const body = razorpay_order_id + "|" + razorpay_payment_id;
  
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_LIVE_SECRET)
    .update(body.toString())
    .digest('hex');

  const isAuthentic = expectedSignature === razorpay_signature;

  if (isAuthentic) {
    try {
      const order = await razorpayInstance.orders.fetch(razorpay_order_id);

      await pool.query('START TRANSACTION');

      for (const item of items) {
        await pool.query('UPDATE products SET quantity = quantity - ? WHERE id = ?', [item.quantity, item.productId]);

        await pool.query(
          'INSERT INTO orders (user, product_id, quantity, amount, razorpay_order_id, razorpay_payment_id, address, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [email, item.productId, item.quantity, order.amount / 100, razorpay_order_id, razorpay_payment_id, address, phone]
        );
      }

      await pool.query('COMMIT');

      res.json({
        success: true,
        message: "Payment has been verified and order has been placed successfully"
      });
    } catch (error) {
      await pool.query('ROLLBACK');
      console.error('Error processing bulk payment:', error);
      res.status(500).json({ success: false, message: "Error processing payment" });
    }
  } else {
    res.status(400).json({ success: false, message: "Invalid signature" });
  }
});

app.get('/api/coupons', verifyToken,async (req, res) => {
  try {
    const [coupons] = await pool.query('SELECT * FROM coupons');
    res.json(coupons);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


app.post('/api/coupons', verifyToken, async (req, res) => {
  const { code, discount, discountPercent, productId, minPurchase } = req.body;
  try {
 

    if (productId) {
      const [products] = await pool.query('SELECT id FROM products WHERE id = ?', [productId]);
      if (products.length === 0) {
        productId = null;
      }
    }

    const [existingCoupons] = await pool.query('SELECT id FROM coupons WHERE code = ?', [code]);
    if (existingCoupons.length > 0) {
      throw new Error('Coupon code already exists');
    }

    await pool.query('INSERT INTO coupons (code, discount, discount_percent, product_id, min_purchase) VALUES (?, ?, ?, ?, ?)', 
      [code, discount, discountPercent, productId, minPurchase]);
    
    res.status(201).json({ code, discount, discountPercent, productId, minPurchase });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put('/api/coupons/:id', verifyToken, async (req, res) => {
  const { code, discount, discountPercent, product_id, min_purchase } = req.body;
  try {
    if (product_id) {
      const [products] = await pool.query('SELECT id FROM products WHERE id = ?', [product_id]);
      if (products.length === 0) {
      product_id = null;
      }
    }
    await pool.query('UPDATE coupons SET code = ?, discount = ?, discount_percent = ?, product_id = ?, min_purchase = ? WHERE id = ?', 
      [code, discount, discountPercent, product_id, min_purchase, req.params.id]);
    
    res.status(200).json({ message: 'Coupon updated successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


app.delete('/api/coupons/:id', verifyToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM coupons WHERE id = ?', [req.params.id]);
    res.status(200).json({ message: 'Coupon Deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/verifyCoupon', async (req, res) => {
  const { code, totalAmount, productId } = req.body;
  try {
    const [coupons] = await pool.query('SELECT * FROM coupons WHERE code = ?', [code]);
    if (coupons.length === 0) {
      return res.status(404).json({ success: false, message: 'Invalid coupon code' });
    }

    const coupon = coupons[0];

    if (coupon.min_purchase > totalAmount) {
      return res.status(400).json({ success: false, message: `Minimum purchase of ₹${coupon.min_purchase} required` });
    }
    if (!coupon.product_id && coupon.min_purchase) {
      const fixedDiscount = coupon.discount || 0;
      const percentDiscount = coupon.discount_percent ? (totalAmount * coupon.discount_percent / 100) : 0;
      const discount = Math.floor( Math.round(fixedDiscount || percentDiscount));
      return res.status(200).json({ success: true, discount, message: 'Coupon universal applied' });
    } else if (coupon.product_id && coupon.product_id !== productId) {
      return res.status(400).json({ success: false, message: 'Coupon not valid for this product' });
    }

    const fixedDiscount = coupon.discount || 0;
    const percentDiscount = coupon.discount_percent ? (totalAmount * coupon.discount_percent / 100) : 0;
    const discount = percentDiscount > fixedDiscount ? percentDiscount : fixedDiscount;
    res.json({ success: true, discount, message: 'Coupon applied successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
