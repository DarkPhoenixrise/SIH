// server.js - Backend API Server with Real-Time ChatGPT Integration
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const PORT = 3000;

// ========== IMPORTANT: ADD YOUR OPENAI API KEY HERE ==========
// Get your API key from: https://platform.openai.com/api-keys
const OPENAI_API_KEY = 'your-openai-api-key-here';
// You can also use environment variable: process.env.OPENAI_API_KEY
// =============================================================

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());

// Initialize SQLite Database
const db = new sqlite3.Database('./learning_platform.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        initializeDatabase();
    }
});

// Create Tables
function initializeDatabase() {
    // Users Table
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('student', 'teacher')),
            school TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Error creating users table:', err);
        } else {
            console.log('Users table ready');
        }
    });

    // AI Questions Log Table
    db.run(`
        CREATE TABLE IF NOT EXISTS ai_questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            question TEXT NOT NULL,
            answer TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `, (err) => {
        if (err) {
            console.error('Error creating ai_questions table:', err);
        } else {
            console.log('AI questions table ready');
        }
    });

    // Progress Tracking Table
    db.run(`
        CREATE TABLE IF NOT EXISTS progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            subject TEXT NOT NULL,
            lesson_index INTEGER NOT NULL,
            completed BOOLEAN DEFAULT 0,
            score INTEGER,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `, (err) => {
        if (err) {
            console.error('Error creating progress table:', err);
        } else {
            console.log('Progress table ready');
        }
    });
}

// ==================== API ROUTES ====================

// Register New User
app.post('/api/register', async (req, res) => {
    const { name, email, password, role, school } = req.body;

    // Validation
    if (!name || !email || !password || !role || !school) {
        return res.status(400).json({ message: 'All fields are required' });
    }

    if (!['student', 'teacher'].includes(role)) {
        return res.status(400).json({ message: 'Invalid role specified' });
    }

    try {
        // Check if user already exists
        db.get('SELECT * FROM users WHERE email = ?', [email], async (err, row) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }

            if (row) {
                return res.status(400).json({ message: 'User with this email already exists' });
            }

            // Hash password
            const hashedPassword = await bcrypt.hash(password, 10);

            // Insert new user
            db.run(
                'INSERT INTO users (name, email, password, role, school) VALUES (?, ?, ?, ?, ?)',
                [name, email, hashedPassword, role, school],
                function(err) {
                    if (err) {
                        return res.status(500).json({ message: 'Failed to register user', error: err.message });
                    }

                    res.status(201).json({
                        message: 'User registered successfully',
                        userId: this.lastID
                    });
                }
            );
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Login User
app.post('/api/login', async (req, res) => {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
        return res.status(400).json({ message: 'Email, password, and role are required' });
    }

    try {
        db.get('SELECT * FROM users WHERE email = ? AND role = ?', [email, role], async (err, user) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }

            if (!user) {
                return res.status(401).json({ message: 'Invalid credentials or role' });
            }

            // Verify password
            const isPasswordValid = await bcrypt.compare(password, user.password);

            if (!isPasswordValid) {
                return res.status(401).json({ message: 'Invalid credentials' });
            }

            // Don't send password back
            const { password: _, ...userWithoutPassword } = user;

            res.json({
                message: 'Login successful',
                user: userWithoutPassword
            });
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Ask AI Question (Real-time AI using OpenAI ChatGPT)
app.post('/api/ask-ai', async (req, res) => {
    const { question, userId } = req.body;

    if (!question) {
        return res.status(400).json({ message: 'Question is required' });
    }

    try {
        // Get AI response from OpenAI
        const aiAnswer = await generateAIResponse(question);

        // Log the question and answer
        if (userId) {
            db.run(
                'INSERT INTO ai_questions (user_id, question, answer) VALUES (?, ?, ?)',
                [userId, question, aiAnswer],
                (err) => {
                    if (err) {
                        console.error('Error logging AI question:', err);
                    }
                }
            );
        }

        res.json({
            question: question,
            answer: aiAnswer
        });
    } catch (error) {
        console.error('AI service error:', error.message);
        res.status(500).json({ 
            message: 'AI service error', 
            error: error.message,
            answer: getFallbackResponse(question)
        });
    }
});

// ========== REAL-TIME AI RESPONSE USING OPENAI CHATGPT ==========
async function generateAIResponse(question) {
    // Check if API key is configured
    if (!OPENAI_API_KEY || OPENAI_API_KEY === 'your-openai-api-key-here') {
        console.warn('OpenAI API key not configured. Using fallback responses.');
        return getFallbackResponse(question);
    }

    try {
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-3.5-turbo', // or 'gpt-4' for better responses
                messages: [
                    {
                        role: 'system',
                        content: `You are a helpful, friendly teacher for rural Punjab school students (ages 8-16). 
                        Your responses should be:
                        - Simple and easy to understand
                        - In English (students are learning)
                        - Use examples from Punjab/India context when possible
                        - Encouraging and positive
                        - Include emojis to make it fun 😊
                        - Keep answers concise (2-3 paragraphs max)
                        - Focus on subjects: Math, Science, English, Punjabi, Social Studies
                        - If asked about Punjab, mention its culture, agriculture, festivals
                        - Always end with an encouraging note or follow-up question`
                    },
                    {
                        role: 'user',
                        content: question
                    }
                ],
                max_tokens: 300,
                temperature: 0.7,
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENAI_API_KEY}`
                }
            }
        );

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('OpenAI API Error:', error.response?.data || error.message);
        
        // If API fails, use fallback
        return getFallbackResponse(question);
    }
}

// Fallback responses if OpenAI API is not available
function getFallbackResponse(question) {
    const lowerQuestion = question.toLowerCase();

    // Enhanced keyword-based responses for demo
    
    // Math related
    if (lowerQuestion.includes('multiply') || lowerQuestion.includes('multiplication') || lowerQuestion.includes('times')) {
        return 'Multiplication is repeated addition! For example, 3 × 4 means adding 3 four times: 3+3+3+3 = 12. The multiplication tables help you remember these quickly. Would you like to practice any specific table?';
    }
    if (lowerQuestion.includes('divide') || lowerQuestion.includes('division')) {
        return 'Division is splitting things into equal parts! If you have 12 apples and want to share them among 3 friends, each gets 4 apples (12 ÷ 3 = 4). Think of it as the opposite of multiplication!';
    }
    if (lowerQuestion.includes('fraction')) {
        return 'Fractions represent parts of a whole! Like if you cut a roti into 4 pieces and eat 1 piece, you ate 1/4 (one-fourth) of the roti. The top number shows parts you have, bottom shows total parts.';
    }
    if (lowerQuestion.includes('math') || lowerQuestion.includes('addition') || lowerQuestion.includes('add') || lowerQuestion.includes('subtract') || lowerQuestion.includes('minus')) {
        return 'Mathematics is fun! Addition means combining numbers (5+3=8), and subtraction means taking away (10-4=6). Think of it like adding or removing mangoes from a basket. Would you like to practice some problems?';
    }
    
    // Science related
    if (lowerQuestion.includes('water cycle') || lowerQuestion.includes('rain') || lowerQuestion.includes('evaporation')) {
        return 'The water cycle is amazing! ☀️ Sun heats water → 💨 Water evaporates (becomes vapor) → ☁️ Forms clouds → 🌧️ Rain falls → 🌊 Collects in rivers/oceans → Cycle repeats! This is how Punjab gets monsoon rains!';
    }
    if (lowerQuestion.includes('photosynthesis') || lowerQuestion.includes('how plant') || lowerQuestion.includes('plant make food')) {
        return 'Plants are like little factories! They use: 🌞 Sunlight + 💧 Water + 🌫️ CO2 (from air) → 🍃 Make their own food (glucose) + Release oxygen for us to breathe! The green color (chlorophyll) helps capture sunlight.';
    }
    if (lowerQuestion.includes('solar system') || lowerQuestion.includes('planet') || lowerQuestion.includes('sun') || lowerQuestion.includes('earth')) {
        return 'Our Solar System has 8 planets revolving around the Sun! 🌞 Mercury, Venus, Earth (our home!), Mars, Jupiter, Saturn, Uranus, Neptune. Earth is special - it has water, air, and life! It takes 365 days to go around the Sun.';
    }
    if (lowerQuestion.includes('science') || lowerQuestion.includes('plant') || lowerQuestion.includes('animal') || lowerQuestion.includes('bird')) {
        return 'Science helps us understand the world! 🌱 Plants need sunlight, water, and soil to grow. 🐕 Animals need food, water, shelter, and air to survive. Punjab has beautiful crops like wheat and rice, and birds like sparrows and parrots!';
    }
    
    // Punjabi language
    if (lowerQuestion.includes('gurmukhi') || lowerQuestion.includes('punjabi alphabet') || lowerQuestion.includes('ਅੱਖਰ')) {
        return 'Gurmukhi script has 35 letters (akhar)! The vowels are: ਅ ਆ ਇ ਈ ਉ ਊ ਏ ਐ ਓ ਔ. Consonants start with: ਸ ਹ ਕ ਖ ਗ ਘ ਙ... It was standardized by Guru Angad Dev Ji. Practice writing one letter daily!';
    }
    if (lowerQuestion.includes('punjabi') || lowerQuestion.includes('ਪੰਜਾਬੀ')) {
        return 'Punjabi is our beautiful mother tongue! It\'s written in Gurmukhi script with 35 letters. Common words: ਸਤ ਸ੍ਰੀ ਅਕਾਲ (Hello), ਧੰਨਵਾਦ (Thank you), ਪਾਣੀ (Water). Would you like to learn some words or letters?';
    }
    
    // English
    if (lowerQuestion.includes('grammar') || lowerQuestion.includes('noun') || lowerQuestion.includes('verb')) {
        return 'English grammar is important! 📝 NOUN = naming word (boy, Punjab, school), VERB = action word (run, study, eat), ADJECTIVE = describing word (beautiful, smart). Example: "The clever student reads books." Try making your own sentence!';
    }
    if (lowerQuestion.includes('tense') || lowerQuestion.includes('past') || lowerQuestion.includes('present') || lowerQuestion.includes('future')) {
        return 'Tenses show time! ⏰ PRESENT: I study (now), PAST: I studied (before), FUTURE: I will study (later). Practice: "I eat rice" (present), "I ate rice" (past), "I will eat rice" (future). What tense do you need help with?';
    }
    if (lowerQuestion.includes('english') || lowerQuestion.includes('alphabet')) {
        return 'English has 26 letters: A-Z! 🔤 Vowels (A,E,I,O,U) are special letters. Practice: Read English books daily, watch English cartoons, speak with friends. Start with simple words: CAT, DOG, SUN, MOON. What would you like to learn?';
    }
    
    // Social Studies
    if (lowerQuestion.includes('punjab') || lowerQuestion.includes('capital') || lowerQuestion.includes('chandigarh')) {
        return 'Punjab is our beautiful state! 🌾 Capital: Chandigarh, Language: Punjabi, Famous for: Golden Temple, agriculture (wheat, rice), Bhangra dance, and brave people. Major cities: Amritsar, Ludhiana, Jalandhar, Patiala. Punjab means "Land of Five Rivers"!';
    }
    if (lowerQuestion.includes('india') || lowerQuestion.includes('country') || lowerQuestion.includes('delhi')) {
        return 'India is our great country! 🇮🇳 Capital: New Delhi, National Animal: Tiger, National Bird: Peacock, National Flower: Lotus. India has 28 states and 8 union territories. We have diverse cultures, languages, and religions living together!';
    }
    if (lowerQuestion.includes('festival') || lowerQuestion.includes('baisakhi') || lowerQuestion.includes('diwali') || lowerQuestion.includes('lohri')) {
        return 'Punjab celebrates many festivals! 🎉 Baisakhi (harvest festival), Lohri (winter festival), Diwali (festival of lights), Holi (festival of colors), Gurpurab (Guru\'s birthday). These bring families together with food, dance, and joy!';
    }
    
    // General help
    if (lowerQuestion.includes('how to study') || lowerQuestion.includes('study tips')) {
        return 'Great study tips! 📚 1) Study same time daily 2) Take short breaks 3) Teach others what you learn 4) Make colorful notes 5) Ask questions when confused 6) Practice problems daily 7) Sleep well 8) Stay positive! Which subject do you want to focus on?';
    }
    if (lowerQuestion.includes('help') || lowerQuestion.includes('homework') || lowerQuestion.includes('doubt')) {
        return 'I\'m here to help you! 🎓 Tell me specifically: What subject? What topic? What don\'t you understand? For example: "Help me with multiplication tables" or "Explain water cycle". The more specific you are, the better I can help!';
    }
    if (lowerQuestion.includes('thank') || lowerQuestion.includes('thanks')) {
        return 'You\'re welcome! 😊 Keep learning and asking questions. Remember, there\'s no silly question - every question helps you learn! What else would you like to know?';
    }
    if (lowerQuestion.includes('who are you') || lowerQuestion.includes('what are you')) {
        return 'I\'m your AI Learning Assistant! 🤖 I\'m here to help you understand Math, Science, English, Punjabi, and Social Studies. I can explain concepts, give examples, and answer your questions. Think of me as your study buddy available anytime!';
    }
    
    // Default helpful response
    return `I'd love to help you learn! I can explain topics in:\n\n📐 Math - Addition, subtraction, multiplication, division, fractions\n🔬 Science - Plants, animals, water cycle, solar system\n📚 Punjabi - Gurmukhi alphabet, words, grammar\n🌍 English - Alphabet, grammar, tenses, vocabulary\n🌾 Social Studies - Punjab, India, festivals, geography\n\nPlease ask me something specific like "Explain multiplication" or "What is the water cycle?" and I'll give you a clear answer!`;
}
// =================================================================

// Get User Progress
app.get('/api/progress/:userId', (req, res) => {
    const { userId } = req.params;

    db.all(
        'SELECT * FROM progress WHERE user_id = ? ORDER BY updated_at DESC',
        [userId],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            res.json(rows);
        }
    );
});

// Save Progress
app.post('/api/progress', (req, res) => {
    const { userId, subject, lessonIndex, completed, score } = req.body;

    if (!userId || !subject || lessonIndex === undefined) {
        return res.status(400).json({ message: 'userId, subject, and lessonIndex are required' });
    }

    db.run(
        `INSERT INTO progress (user_id, subject, lesson_index, completed, score) 
         VALUES (?, ?, ?, ?, ?)`,
        [userId, subject, lessonIndex, completed ? 1 : 0, score],
        function(err) {
            if (err) {
                return res.status(500).json({ message: 'Failed to save progress', error: err.message });
            }
            res.json({ message: 'Progress saved successfully', id: this.lastID });
        }
    );
});

// Get All Users (Admin/Teacher view)
app.get('/api/users', (req, res) => {
    db.all('SELECT id, name, email, role, school, created_at FROM users', [], (err, rows) => {
        if (err) {
            return res.status(500).json({ message: 'Database error', error: err.message });
        }
        res.json(rows);
    });
});

// Get AI Question History
app.get('/api/ai-questions/:userId', (req, res) => {
    const { userId } = req.params;

    db.all(
        'SELECT * FROM ai_questions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
        [userId],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ message: 'Database error', error: err.message });
            }
            res.json(rows);
        }
    );
});

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Server is running',
        aiEnabled: OPENAI_API_KEY && OPENAI_API_KEY !== 'your-openai-api-key-here'
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`\n🚀 Server is running on http://localhost:${PORT}`);
    console.log(`📡 API endpoints available at http://localhost:${PORT}/api`);
    
    if (!OPENAI_API_KEY || OPENAI_API_KEY === 'your-openai-api-key-here') {
        console.log(`\n⚠️  OpenAI API key not configured - using fallback responses`);
        console.log(`💡 To enable real AI: Add your API key in server.js line 10`);
        console.log(`   Get free key: https://platform.openai.com/api-keys\n`);
    } else {
        console.log(`\n✅ OpenAI ChatGPT integration active!\n`);
    }
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});