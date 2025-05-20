const redis = require('redis');
const redisClient = redis.createClient(); // default localhost:6379

redisClient.on('error', (err) => {
  console.error('Redis client error', err);
});

(async () => {
  await redisClient.connect();
})();

// Key used for caching messages
const CACHE_KEY_MESSAGES = 'messages_all';

// Updated GET /api/messages to use Redis cache
app.get('/api/messages', authenticateToken, async (req, res) => {
  try {
    // Try to get cached messages
    const cachedMessages = await redisClient.get(CACHE_KEY_MESSAGES);
    if (cachedMessages) {
      console.log('Cache hit for messages');
      return res.json(JSON.parse(cachedMessages));
    }

    console.log('Cache miss for messages, querying DB');
    const sql = `
      SELECT m.id, m.content, m.created_at, u.username
      FROM messages m
      JOIN users u ON m.user_id = u.id
      ORDER BY m.created_at ASC
    `;
    db.all(sql, [], async (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to retrieve messages' });
      }
      // Cache messages in Redis for 60 seconds
      await redisClient.setEx(CACHE_KEY_MESSAGES, 60, JSON.stringify(rows));
      return res.json(rows);
    });
  } catch (error) {
    console.error('Redis or DB error', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Updated POST /api/messages to clear cache after inserting message
app.post('/api/messages', authenticateToken, (req, res) => {
  const { content } = req.body;
  if (!content || content.trim() === '') {
    return res.status(400).json({ error: 'Message content is required' });
  }

  const userId = req.user.id;
  const stmt = db.prepare('INSERT INTO messages(user_id, content) VALUES(?, ?)');
  stmt.run(userId, content.trim(), async function (err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to save message' });
    }
    // Invalidate cache after new message
    try {
      await redisClient.del(CACHE_KEY_MESSAGES);
    } catch (cacheErr) {
      console.error('Failed to clear message cache', cacheErr);
    }

    // Return the new message including username and timestamp
    const sql = `
      SELECT m.id, m.content, m.created_at, u.username
      FROM messages m
      JOIN users u ON m.user_id = u.id
      WHERE m.id = ?
    `;
    db.get(sql, [this.lastID], (err2, row) => {
      if (err2) {
        return res.status(500).json({ error: 'Failed to retrieve new message' });
      }
      return res.status(201).json(row);
    });
  });
  stmt.finalize();
});
