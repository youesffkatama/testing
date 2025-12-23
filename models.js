// models.js - MongoDB Database Models for Bible.AI
const mongoose = require('mongoose');

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bibleai', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ MongoDB Connected Successfully');
  } catch (err) {
    console.error('⚠️ MongoDB Connection Error:', err.message);
    console.error('Continuing without database connection (dev fallback).');
    // Do not exit the process in development; allow server to run for static testing.
    return;
  }
};

// User Schema
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  hash: { type: String, required: true },
  salt: { type: String, required: true },
  createdAt: { type: String, default: () => new Date().toISOString().split('T')[0] },
  lastLogin: { type: String, default: null },
  status: { type: String, default: 'active' },
  phone: { type: String, default: '' },
  profilePic: { type: String, default: '' },
  token: { type: String, default: null },
  tokenExpiry: { type: Number, default: null }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

// Log Schema
const logSchema = new mongoose.Schema({
  type: { type: String, required: true },
  user: { type: String, required: true },
  action: { type: String, required: true },
  ip: { type: String, default: 'unknown' },
  timestamp: { type: String, default: () => new Date().toISOString() },
  time: { type: String, default: () => new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) },
  userAgent: { type: String, default: 'unknown' }
}, { timestamps: true });

const Log = mongoose.model('Log', logSchema);

// Notification Schema
const notificationSchema = new mongoose.Schema({
  userEmail: { type: String, required: true, index: true },
  type: { type: String, default: 'system' }, // email, system, verse
  title: { type: String, required: true },
  message: { type: String, required: true },
  time: { type: String, default: () => new Date().toISOString() },
  read: { type: Boolean, default: false }
}, { timestamps: true });

const Notification = mongoose.model('Notification', notificationSchema);

// Email Log Schema
const emailLogSchema = new mongoose.Schema({
  to: { type: String, required: true },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  timestamp: { type: String, default: () => new Date().toISOString() },
  status: { type: String, default: 'sent' }
}, { timestamps: true });

const EmailLog = mongoose.model('EmailLog', emailLogSchema);

// Note Schema
const noteSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  text: { type: String, required: true },
  bookId: { type: String, default: null },
  bookName: { type: String, default: null },
  timestamp: { type: String, default: () => new Date().toISOString() }
}, { timestamps: true });

const Note = mongoose.model('Note', noteSchema);

// Journal Entry Schema
const journalSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  verse: { type: String, default: '' },
  content: { type: String, required: true },
  tags: [{ type: String }],
  mood: { type: String, default: 'neutral' },
  date: { type: String, default: () => new Date().toISOString() }
}, { timestamps: true });

const Journal = mongoose.model('Journal', journalSchema);

// Book Stats Schema
const bookStatsSchema = new mongoose.Schema({
  userEmail: { type: String, required: true, unique: true },
  books: [{ type: String }],
  totalViews: { type: Number, default: 0 },
  lastViewed: { type: Map, of: mongoose.Schema.Types.Mixed }
}, { timestamps: true });

const BookStats = mongoose.model('BookStats', bookStatsSchema);

module.exports = {
  connectDB,
  User,
  Log,
  Notification,
  EmailLog,
  Note,
  Journal,
  BookStats
};