// server.js - Bible.AI Complete Backend with MongoDB (v2.0.0)
require('dotenv').config();
var http = require('http');
var https = require('https');
var url = require('url');
var crypto = require('crypto');
var os = require('os');
const mongoose = require('mongoose');

// MongoDB Connection
const { connectDB, User, Log, Notification, EmailLog, Note, Journal, BookStats } = require('./models');

var PORT = process.env.PORT || 3000;
var API_KEY = process.env.OPENROUTER_API_KEY || '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';
//MONGODB_URI="mongodb+srv://yusufkaram:Church@bibleai.pewfze2.mongodb.net/bibleai?appName=bibleai" OPENROUTER_API_KEY="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" npm start

if (!API_KEY) {

  console.error('⚠️  WARNING: OPENROUTER_API_KEY not set!');
}

// Admin credentials
var ADMIN_EMAIL = 'admin@bibleai.com';
var ADMIN_PASSWORD = 'BibleAI@2025';
var ADMIN_TOKEN = null;

// Get local IP
function getLocalIP() {
  var interfaces = os.networkInterfaces();
  for (var devName in interfaces) {
    var iface = interfaces[devName];
    for (var i = 0; i < iface.length; i++) {
      var alias = iface[i];
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return '0.0.0.0';
}

// Password hashing
function hashPassword(password) {
  var salt = crypto.randomBytes(16).toString('hex');
  var hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt: salt, hash: hash };
}

function verifyPassword(password, hash, salt) {
  var hashToVerify = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return hash === hashToVerify;
}

// Auth middleware
function getAuthToken(req) {
  var authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.split(' ')[1];
}

async function isUser(req) {
  var token = getAuthToken(req);
  if (!token) return false;

  try {
    const user = await User.findOne({ 
      token: token, 
      tokenExpiry: { $gt: Date.now() } 
    });
    
    if (user) {
      req.user = user;
      return true;
    }
  } catch (err) {
    console.error('Auth error:', err);
  }
  return false;
}

function isAdmin(req) {
  var token = getAuthToken(req);
  if (!token) return false;
  
  if (ADMIN_TOKEN && token === ADMIN_TOKEN.token) {
    if (Date.now() >= ADMIN_TOKEN.expires) {
      ADMIN_TOKEN = null;
      return false;
    }
    ADMIN_TOKEN.expires = Date.now() + 3600000;
    return true;
  }
  return false;
}

// Add log entry
async function addLog(type, user, action, req) {
  var ip = 'unknown';
  
  if (req) {
    ip = req.headers['x-forwarded-for'] || 
         req.headers['x-real-ip'] || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress ||
         'unknown';
    
    if (ip === '::1' || ip === '::ffff:127.0.0.1') {
      ip = '127.0.0.1';
    }
  }
  
  try {
    await Log.create({
      type: type,
      user: user,
      action: action,
      ip: ip,
      userAgent: req ? (req.headers['user-agent'] || 'unknown') : 'unknown'
    });
  } catch (err) {
    console.error('Error saving log:', err);
  }
}

// Add notification
async function addNotification(userEmail, title, message, type) {
  try {
    await Notification.create({
      userEmail: userEmail,
      type: type || 'system',
      title: title,
      message: message.replace(/<[^>]*>/g, ''),
      read: false
    });
    console.log('📬 Notification added for:', userEmail);
  } catch (err) {
    console.error('Error adding notification:', err);
  }
}

// Send email (simulated + notification)
async function sendEmail(to, subject, message) {
  try {
    await EmailLog.create({
      to: to,
      subject: subject,
      message: message,
      status: 'sent'
    });
    
    await addNotification(to, subject, message, 'email');
    console.log('📧 Email logged:', to, '-', subject);
    return true;
  } catch (err) {
    console.error('Error sending email:', err);
    return false;
  }
}

// MIME types
var mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

// Create HTTP server
var server = http.createServer(async function (req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE, PUT');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  var parsedUrl = url.parse(req.url, true);
  var pathname = parsedUrl.pathname;

  // ===== SIGNUP ENDPOINT =====
  if (req.method === 'POST' && pathname === '/signup') {
    var body = '';
    req.on('data', function (chunk) {
      body += chunk;
      if (body.length > 1e6) {
        res.writeHead(413, { 'Content-Type': 'text/plain' });
        req.connection.destroy();
      }
    });

    req.on('end', async function () {
      try {
        var parsed = JSON.parse(body);
        var name = parsed.name;
        var username = parsed.username;
        var password = parsed.password;

        if (!name || !username || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ message: 'Missing required fields' }));
        }
        
        if (password.length < 6) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ message: 'Password must be at least 6 characters' }));
        }

        const existingUser = await User.findOne({ email: username.toLowerCase() });
        if (existingUser) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ message: 'User already exists' }));
        }

        var hashData = hashPassword(password);

        await User.create({
          name: name,
          email: username.toLowerCase(),
          hash: hashData.hash,
          salt: hashData.salt,
          status: 'active'
        });

        await addLog('signup', name, 'Account created', req);
        await sendEmail(username, 'Welcome to Bible.AI', 
          '<h1>Welcome to Bible.AI!</h1><p>Thank you for joining our community.</p>');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Signup successful', name: name }));
      } catch (err) {
        console.error('Signup error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Server error during signup' }));
      }
    });
    return;
  }

  // ===== LOGIN ENDPOINT =====
  if (req.method === 'POST' && pathname === '/login') {
    var body = '';
    req.on('data', function (chunk) { body += chunk; });

    req.on('end', async function () {
      try {
        var parsed = JSON.parse(body);
        var username = parsed.username;
        var password = parsed.password;

        if (!username || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ message: 'Missing username or password' }));
        }
        
        // Admin Login
        if (username === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
          var adminToken = crypto.randomBytes(32).toString('hex');
          ADMIN_TOKEN = { token: adminToken, expires: Date.now() + 3600000 };
          
          await addLog('login', 'Admin', 'Admin logged in', req);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ 
            message: 'Admin login successful', 
            isAdmin: true, 
            token: adminToken,
            name: 'Admin' 
          }));
        }

        // User Login
        const user = await User.findOne({ email: username.toLowerCase() });
        
        if (!user || !verifyPassword(password, user.hash, user.salt)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ message: 'Invalid credentials' }));
        }

        var userToken = crypto.randomBytes(32).toString('hex');
        user.token = userToken;
        user.tokenExpiry = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days
        user.lastLogin = new Date().toISOString();
        user.status = 'active';
        await user.save();
        
        await addLog('login', user.name, 'User logged in', req);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          message: 'Login successful', 
          isAdmin: false, 
          name: user.name, 
          profilePic: user.profilePic || '',
          token: userToken
        }));
        
      } catch (err) {
        console.error('Login error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Server error during login' }));
      }
    });
    return;
  }

  // ===== GET NOTIFICATIONS ENDPOINT =====
  if (req.method === 'GET' && pathname === '/notifications') {
    if (!(await isUser(req))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Unauthorized' }));
    }
    
    try {
      const notifications = await Notification.find({ userEmail: req.user.email })
        .sort({ createdAt: -1 })
        .limit(50);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ notifications: notifications }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Error loading notifications' }));
    }
    return;
  }

  // ===== CHANGE PASSWORD ENDPOINT =====
  if (req.method === 'POST' && pathname === '/changepassword') {
    if (!(await isUser(req))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Unauthorized' }));
    }
    
    var body = '';
    req.on('data', function (chunk) { body += chunk; });
    req.on('end', async function () {
      try {
        var parsed = JSON.parse(body);
        var currentPass = parsed.currentPass;
        var newPass = parsed.newPass;

        if (!currentPass || !newPass) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ message: 'Missing required fields' }));
        }
        
        if (newPass.length < 6) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ message: 'Password must be at least 6 characters' }));
        }

        if (!verifyPassword(currentPass, req.user.hash, req.user.salt)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ message: 'Current password incorrect' }));
        }
        
        var hashData = hashPassword(newPass);
        req.user.hash = hashData.hash;
        req.user.salt = hashData.salt;
        await req.user.save();
        
        await addLog('security', req.user.name, 'Password changed', req);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Password updated successfully' }));
        
      } catch (err) {
        console.error('Password change error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Server error' }));
      }
    });
    return;
  }

  // ===== UPDATE PROFILE =====
  if (req.method === 'POST' && pathname === '/update-profile') {
    if (!(await isUser(req))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Unauthorized' }));
    }
    
    var body = '';
    req.on('data', function (chunk) { body += chunk; });
    req.on('end', async function () {
      try {
        var parsed = JSON.parse(body);
        req.user.name = parsed.name || req.user.name;
        req.user.phone = parsed.phone || req.user.phone;
        await req.user.save();
        await addLog('update', req.user.name, 'Profile updated', req);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Profile updated' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Server error' }));
      }
    });
    return;
  }
  
  // ===== UPDATE PROFILE PIC =====
  if (req.method === 'POST' && pathname === '/update-profile-pic') {
    if (!(await isUser(req))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Unauthorized' }));
    }
    
    var body = '';
    req.on('data', function (chunk) {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
         res.writeHead(413, { 'Content-Type': 'text/plain' });
         req.connection.destroy();
      }
    });
    req.on('end', async function () {
      try {
        var parsed = JSON.parse(body);
        req.user.profilePic = parsed.imageData;
        await req.user.save();
        await addLog('update', req.user.name, 'Profile picture updated', req);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Profile picture updated' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Server error' }));
      }
    });
    return;
  }

  // ===== ADMIN USERS ENDPOINT =====
  if (req.method === 'GET' && pathname === '/admin/users') {
    if (!isAdmin(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Unauthorized' }));
    }
    
    try {
      const today = new Date().toISOString().split('T')[0];
      const users = await User.find().select('-hash -salt -token');
      const activeUsers = users.filter(u => u.status === 'active').length;
      const logs = await Log.find().sort({ createdAt: -1 }).limit(20);
      const todayLogins = logs.filter(l => 
        l.type === 'login' && l.timestamp.split('T')[0] === today
      ).length;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        totalUsers: users.length,
        activeUsers: activeUsers,
        todayLogins: todayLogins,
        users: users.map(u => ({
          name: u.name,
          email: u.email,
          createdAt: u.createdAt,
          lastLogin: u.lastLogin ? new Date(u.lastLogin).toLocaleString('en-US') : 'Never',
          status: u.status
        })),
        logs: logs
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Server error' }));
    }
    return;
  }

  // ===== DELETE USER =====
  if (req.method === 'DELETE' && pathname.startsWith('/admin/users/')) {
    if (!isAdmin(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Unauthorized' }));
    }
    
    try {
      var email = decodeURIComponent(pathname.split('/').pop());
      const deletedUser = await User.findOneAndDelete({ email: email });
      
      if (!deletedUser) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ message: 'User not found' }));
      }

      await addLog('delete', 'Admin', 'Deleted user: ' + deletedUser.name, req);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'User deleted successfully' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Server error' }));
    }
    return;
  }

  // ===== SEND EMAIL =====
  if (req.method === 'POST' && pathname === '/admin/send-email') {
    if (!isAdmin(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Unauthorized' }));
    }
    
    var body = '';
    req.on('data', function (chunk) { body += chunk; });
    req.on('end', async function () {
      try {
        var parsed = JSON.parse(body);
        var recipient = parsed.recipient;
        var subject = parsed.subject;
        var message = parsed.message;
        
        var recipients = [];
        if (recipient === 'all') {
          const users = await User.find().select('email');
          recipients = users.map(u => u.email);
        } else {
          recipients = [recipient];
        }

        for (let email of recipients) {
          await sendEmail(email, subject, message);
        }

        await addLog('email', 'Admin', 'Sent email to ' + recipient, req);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Email sent successfully' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Server error' }));
      }
    });
    return;
  }

  // ===== AI CHAT ENDPOINT =====
  if (req.method === 'POST' && pathname === '/ask') {
    if (!(await isUser(req))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ reply: '❌ Unauthorized' }));
    }

    var body = '';
    req.on('data', function (chunk) { body += chunk; });

    req.on('end', async function () {
      var userMsg, bookContext, language, chatHistory, deepSearch;
      try {
        var parsed = JSON.parse(body);
        userMsg = parsed.message;
        bookContext = parsed.bookContext || 'I am a Bible AI assistant.';
        language = parsed.language || 'ar';
        chatHistory = parsed.chatHistory || [];
        deepSearch = parsed.deepSearch || false;  // Add this line
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ reply: '❌ Invalid JSON' }));
      }

      var deepSearchPrompt = deepSearch ? 
        ` (DEEP SEARCH MODE: Provide a comprehensive, detailed answer with examples, cross-references, and deeper theological insights. Aim for 2-3x more detail than usual.)` : 
        '';

      var userQuery = userMsg + deepSearchPrompt + ` (Respond ONLY in ${language})`;
      
      var messages = [{ role: 'system', content: bookContext }];
      chatHistory.forEach(function(msg) {
        messages.push({ role: msg.role, content: msg.content });
      });
      messages.push({ role: 'user', content: userQuery });

      var postData = JSON.stringify({
        model: 'tngtech/tng-r1t-chimera:free',
        messages: messages
      });

      var options = {
        hostname: 'openrouter.ai',
        path: '/api/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + API_KEY,
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      
      var apiReq = https.request(options, function (apiRes) {
        var data = '';
        apiRes.on('data', function (chunk) { data += chunk; });
        apiRes.on('end', function () {
          var reply = '⚠️ No reply from AI';
          try {
            var json = JSON.parse(data);
            if (json && json.choices && json.choices[0] && json.choices[0].message) {
              reply = json.choices[0].message.content.trim();
            } else if (json.error) {
              console.error('API Error:', json.error.message);
              reply = '❌ API Error: ' + json.error.message;
            }
          } catch (err) {
            console.error('Parse error:', err);
            reply = '❌ Error parsing AI response.';
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ reply: reply }));
        });
      });

      apiReq.on('error', function (err) {
        console.error('API request error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ reply: '❌ Failed to get AI response' }));
      });

      apiReq.write(postData);
      apiReq.end();
    });

    return;
  }

  // ===== TRACK BOOK VIEW ENDPOINT =====
  if (req.method === 'POST' && pathname === '/track-book') {
    if (!(await isUser(req))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Unauthorized' }));
    }
    
    var body = '';
    req.on('data', function (chunk) { body += chunk; });
    req.on('end', async function () {
      try {
        var data = JSON.parse(body);
        var bookId = data.bookId;
        var bookName = data.bookName;
        
        let userStats = await BookStats.findOne({ userEmail: req.user.email });
        
        if (!userStats) {
          userStats = await BookStats.create({
            userEmail: req.user.email,
            books: [bookId],
            totalViews: 1,
            lastViewed: { [bookId]: { name: bookName, timestamp: new Date().toISOString() } }
          });
        } else {
          if (!userStats.books.includes(bookId)) {
            userStats.books.push(bookId);
          }
          userStats.totalViews += 1;
          userStats.lastViewed.set(bookId, { name: bookName, timestamp: new Date().toISOString() });
          await userStats.save();
        }
        
        await addLog('book', req.user.name, 'Viewed book: ' + bookName, req);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Book tracked' }));
      } catch (err) {
        console.error('Book tracking error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Error tracking book' }));
      }
    });
    return;
  }

  // ===== GET USER BOOK STATS =====
  if (req.method === 'GET' && pathname === '/admin/book-stats') {
    if (!isAdmin(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Unauthorized' }));
    }
    
    try {
      const allStats = await BookStats.find();
      
      const stats = {
        totalUsers: allStats.length,
        totalViews: allStats.reduce((sum, s) => sum + s.totalViews, 0),
        mostViewedBooks: {},
        userStats: allStats.map(s => ({
          email: s.userEmail,
          booksRead: s.books.length,
          totalViews: s.totalViews
        }))
      };
      
      allStats.forEach(userData => {
        userData.books.forEach(bookId => {
          stats.mostViewedBooks[bookId] = (stats.mostViewedBooks[bookId] || 0) + 1;
        });
      });
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Server error' }));
    }
    return;
  }

  // ===== SAVE NOTE ENDPOINT =====
  if (req.method === 'POST' && pathname === '/save-note') {
    if (!(await isUser(req))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Unauthorized' }));
    }
    
    var body = '';
    req.on('data', function (chunk) { body += chunk; });
    req.on('end', async function () {
      try {
        var noteData = JSON.parse(body);
        await Note.create({
          userId: req.user.email,
          text: noteData.text,
          bookId: noteData.bookId,
          bookName: noteData.bookName
        });
        
        await addLog('note', req.user.name, 'Saved quick note', req);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Note saved' }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Error saving note' }));
      }
    });
    return;
  }

  // ===== GET NOTES ENDPOINT =====
  if (req.method === 'GET' && pathname === '/get-notes') {
    if (!(await isUser(req))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Unauthorized' }));
    }
    
    try {
      const notes = await Note.find({ userId: req.user.email })
        .sort({ createdAt: -1 })
        .limit(50);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ notes: notes }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Error loading notes' }));
    }
    return;
  }

  // ===== GET SINGLE NOTE ENDPOINT =====
  if (req.method === 'GET' && pathname.startsWith('/get-note/')) {
    if (!(await isUser(req))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Unauthorized' }));
    }
    
    try {
      var noteId = pathname.split('/').pop();
      const note = await Note.findOne({ _id: noteId, userId: req.user.email });
      
      if (note) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ note: note }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Note not found' }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Error loading note' }));
    }
    return;
  }

  // ===== DELETE NOTE ENDPOINT =====
  if (req.method === 'DELETE' && pathname.startsWith('/delete-note/')) {
    if (!(await isUser(req))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Unauthorized' }));
    }
    try {
      var noteId = pathname.split('/').pop();
      await Note.findOneAndDelete({ _id: noteId, userId: req.user.email });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Note deleted' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Error deleting note' }));
    }
    return;
  }

  // ===== SAVE JOURNAL ENTRY =====
  if (req.method === 'POST' && pathname === '/save-journal') {
    if (!(await isUser(req))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Unauthorized' }));
    }
    
    var body = '';
    req.on('data', function (chunk) { body += chunk; });
    req.on('end', async function () {
      try {
        var entry = JSON.parse(body);
        
        if (entry._id) {
          // Update existing
          await Journal.findOneAndUpdate(
            { _id: entry._id, userId: req.user.email },
            { 
              title: entry.title,
              verse: entry.verse,
              content: entry.content,
              tags: entry.tags,
              mood: entry.mood
            }
          );
        } else {
          // Create new
          await Journal.create({
            userId: req.user.email,
            title: entry.title,
            verse: entry.verse,
            content: entry.content,
            tags: entry.tags,
            mood: entry.mood
          });
        }
        
        await addLog('journal', req.user.name, 'Saved journal entry', req);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Journal saved' }));
      } catch (err) {
        console.error('Journal save error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Error saving journal' }));
      }
    });
    return;
  }

  // ===== GET JOURNAL ENTRIES =====
  if (req.method === 'GET' && pathname === '/get-journals') {
    if (!(await isUser(req))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Unauthorized' }));
    }
    
    try {
      const entries = await Journal.find({ userId: req.user.email })
        .sort({ createdAt: -1 });
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ entries: entries }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Error loading journals' }));
    }
    return;
  }

  // ===== DELETE JOURNAL ENTRY =====
  if (req.method === 'DELETE' && pathname.startsWith('/delete-journal/')) {
    if (!(await isUser(req))) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Unauthorized' }));
    }
    
    try {
      var entryId = pathname.split('/').pop();
      await Journal.findOneAndDelete({ _id: entryId, userId: req.user.email });
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Journal deleted' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Error deleting journal' }));
    }
    return;
  }

// ===== HEALTH CHECK ENDPOINT =====
if (req.method === 'GET' && pathname === '/health') {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  }));
}

  // ===== Serve static files =====
  var fs = require('fs');
  var path = require('path');
  var PUBLIC_DIR = path.join(__dirname, 'public');
  
  var requestPath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  var safePath = path.normalize(requestPath).replace(/^(\.\.[\/\\])+/, '');
  var filePath = path.join(PUBLIC_DIR, safePath);

  if (filePath.indexOf(PUBLIC_DIR) !== 0) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('403 Forbidden');
  }

  fs.stat(filePath, function (err, stats) {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
      return res.end(err.code === 'ENOENT' ? '404 Not Found' : 'Server Error');
    }

    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      fs.stat(filePath, function (err2, stats2) {
        if (err2) {
          res.writeHead(err2.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
          return res.end(err2.code === 'ENOENT' ? '404 Not Found' : 'Server Error');
        }
        streamFile(filePath, stats2, res);
      });
    } else {
      streamFile(filePath, stats, res);
    }
  });

  function streamFile(filePath, stats, res) {
    var ext = path.extname(filePath).toLowerCase();
    var contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': 'public, max-age=3600'
    });
    var readStream = fs.createReadStream(filePath);
    readStream.on('error', function () {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server Error');
    });
    readStream.pipe(res);
  }
});

// Initialize and start server
connectDB().then(() => {
  var localIP = getLocalIP();

  server.listen(PORT, '0.0.0.0', function () {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║       🕊️  Bible.AI Server Running (v2.0.0) 🕊️            ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('📡 Local:    http://localhost:' + PORT);
    console.log('🌍 Network:  http://' + localIP + ':' + PORT);
    console.log('');
    console.log('💾 Database: MongoDB Atlas (Connected)');
    console.log('📝 Admin:    ' + ADMIN_EMAIL);
    console.log('🤖 AI Model: mistralai/mistral-7b-instruct:free');
    console.log('');
    console.log('✅ NEW: Full MongoDB Integration');
    console.log('   📊 Persistent Storage');
    console.log('   🔐 Token Authentication');
    console.log('   📬 Notification System');
    console.log('   📖 Spiritual Journal');
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  });
});

// Graceful shutdown
process.on('SIGINT', function() {
  console.log('\n⚠️  Shutting down server...');
  server.close(function() {
    console.log('✅ Server closed');
    process.exit(0);
  });
});