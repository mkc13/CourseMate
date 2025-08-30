const express = require('express');
const path = require('path');
const http = require("http");
const socketio = require("socket.io");
// app.js (CommonJS)
require('dotenv').config();

const bodyParser = require('body-parser');
const { GoogleGenAI } = require('@google/genai');
const redisClient = require('./redisClient');
const { cacheResponse } = require('./cacheMiddleware');

let marked;
(async () => {
  marked = (await import('marked')).marked; // dynamic import as before
})();
if (process.env.NODE_ENV !== "production") {
  require('dotenv').config();
}

const ejsMate = require('ejs-mate');
const methodOverride = require('method-override');
const mongoose = require('mongoose');
const multer = require('multer');
const fs = require('fs');
const { GridFSBucket } = require('mongodb');
const { Assignment, QuestionPaper, StudyMaterial } = require('./models/first_year'); // Import models
const { Readable } = require('stream');
const first_year = require('./models/first_year');


const pdfParse = require("pdf-parse");
const { createWorker } = require("tesseract.js");
const { fromPath } = require('pdf2pic');


const app = express();
const server = http.createServer(app);
const io = socketio(server);

app.set('view engine', 'ejs');
app.use(bodyParser.json());
app.use(express.static('public'));

// Use API key from environment
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
//____________________________________________________________________________________________________________________________________
/**
 * POST /search
 * Body: { subject: "..." }
 * Uses cache prefix "search" and SEARCH_TTL seconds from env
 */
app.post(
  '/search',
  cacheResponse('search', parseInt(process.env.SEARCH_TTL || '86400', 10)),
  async (req, res) => {
    try {
      const { subject } = req.body;
      if (!subject || !subject.trim()) {
        return res.status(400).json({ error: 'subject is required' });
      }

      // Call AI
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `List all important subtopics name for "${subject}" as bullet points without any description.`,
      });

      const subtopics = (response.text || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line !== '');

      // Cache the result (if middleware set a key)
      try {
        if (res.locals.cacheKey && redisClient && redisClient.isOpen) {
          // store JSON object; use EX option for TTL (seconds)
          await redisClient.set(res.locals.cacheKey, JSON.stringify({ subtopics }), {
            EX: res.locals.cacheTTL,
          });
        }
      } catch (e) {
        console.error('Failed to set cache for /search:', e.message);
      }

      return res.json({ subtopics });
    } catch (error) {
      console.error('/search error:', error);
      return res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }
);

/**
 * POST /explain
 * Body: { subtopic: "..." }
 * Uses cache prefix "explain" and EXPLAIN_TTL seconds
 */
app.post(
  '/explain',
  cacheResponse('explain', parseInt(process.env.EXPLAIN_TTL || '604800', 10)),
  async (req, res) => {
    try {
      const { subtopic } = req.body;
      if (!subtopic || !subtopic.trim()) {
        return res.status(400).json({ error: 'subtopic is required' });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Explain "${subtopic}" in a detailed, beginner-friendly way with headings, bullet points, and formatting.`,
      });

      // Convert markdown to HTML
      const htmlExplanation = marked.parse(response.text || 'No explanation.');

      // Cache the HTML (or store the markdown if you prefer)
      try {
        if (res.locals.cacheKey && redisClient && redisClient.isOpen) {
          await redisClient.set(
            res.locals.cacheKey,
            JSON.stringify({ explanation: htmlExplanation }),
            { EX: res.locals.cacheTTL }
          );
        }
      } catch (e) {
        console.error('Failed to set cache for /explain:', e.message);
      }

      return res.json({ explanation: htmlExplanation });
    } catch (error) {
      console.error('/explain error:', error);
      return res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }
);

/**
 * Dev-only route: Invalidate cache by prefix (useful when content changes)
 * POST /cache/invalidate { prefix: "search" }
 * NOTE: careful: DELETE keys in production is sensitive — protect or remove in prod.
 */
app.post('/cache/invalidate', async (req, res) => {
  try {
    const { prefix } = req.body;
    if (!prefix) return res.status(400).json({ error: 'prefix required' });

    if (!redisClient || !redisClient.isOpen) {
      return res.status(500).json({ error: 'Redis not available' });
    }

    // Use scanIterator to avoid KEYS (blocking)
    let deleted = 0;
    for await (const key of redisClient.scanIterator({ MATCH: `${prefix}:*`, COUNT: 100 })) {
      await redisClient.del(key);
      deleted++;
    }

    return res.json({ ok: true, deleted });
  } catch (err) {
    console.error('cache invalidate error:', err);
    return res.status(500).json({ error: err.message || 'internal error' });
  }
});

//_________________________________________________________________________________________________________________________________

app.engine('ejs', ejsMate);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'views')));

//__________________________________________________________________________________________________________________________________
mongoose
    .connect('mongodb://localhost:27017/first_year')
    .then(() => {
        console.log("Database Connected");
    })
    .catch(() => {
        console.log("error occurred while connecting to MongoDB database in the example file");
    });
let connection = mongoose.connection;
// __________________________________________________________________________________________________________________________________

// RESOURCE

app.get('/resource', (req, res) => {
  res.render('resource/years');
});

app.get('/firstYear', (req, res) => {
res.render('First/landing');
});

app.get('/firstYear/new_upload', (req, res) => {
res.render('First/new');
});




app.get('/firstshowFile/:id' , async(req,res)=>{
const file_assg = await first_year.Assignment.findById(req.params.id);
const file_papers= await first_year.QuestionPaper.findById(req.params.id);
const file_material=await first_year.StudyMaterial.findById(req.params.id);
let file = null
if (file_assg!==null){
  file=file_assg
} 
if (file_papers!==null){
  file=file_papers
} 
if (file_material!==null){
  file=file_material
} 

res.render('First/show',{file});
});


app.get('/firstYear/allfiles', async (req, res) => {
const assignments = await Assignment.find({});
const questionPapers = await QuestionPaper.find({});
const studyMaterials = await StudyMaterial.find({});
const files = [...assignments, ...questionPapers, ...studyMaterials];
res.render('First/index', { files })
})

let gfs; 
connection.on("open", ()=> {
  console.log("file connection open")
  gfs = new mongoose.mongo.GridFSBucket(connection.db); 

  const  storage =  multer.memoryStorage()
  const upload  =   multer({storage})

  app.post('/uploaded_first', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const { subject, topic, contentType, description } = req.body.first_year;
      const fileData = req.file;

      // Store file content in GridFS
      const uploadStream = gfs.openUploadStream(fileData.originalname);
      const buffer = fileData.buffer;
      const readStream = new Readable();
      readStream.push(buffer);
      readStream.push(null);
      readStream.pipe(uploadStream);

      
      let newFile;
      switch (contentType) {
        case 'assignment':
          newFile = await Assignment.create({
            subject,
            topic,
            contentType,
            description,
            file: { filename: fileData.originalname, contentType: fileData.mimetype }
          });
          break;
        case 'questionPaper':
          newFile = await QuestionPaper.create({
            subject,
            topic,
            contentType,
            description,
            file: { filename: fileData.originalname, contentType: fileData.mimetype }
          });
          break;
        case 'studyMaterial':
          newFile = await StudyMaterial.create({
            subject,
            topic,
            contentType,
            description,
            file: { filename: fileData.originalname, contentType: fileData.mimetype }
          });
          break;
        default:
          throw new Error('Invalid content type');
      }

      //res.status(201).json({ file: newFile });
      res.redirect('/firstYear');
    } catch (error) {
      console.error('Upload route error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
    
  });


  app.get('/download/:id', async (req, res) => {
    try {
      const file = await findFileById(req.params.id);
      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }

      // Retrieve file content from GridFS
      const downloadStream = gfs.openDownloadStreamByName(file.file.filename);
      downloadStream.pipe(res);
    } catch (error) {
      console.error('Download route error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

});

async function findFileById(id) {
  let file = null;
  const file_assg = await Assignment.findById(id);
  const file_papers = await QuestionPaper.findById(id);
  const file_material = await StudyMaterial.findById(id);

  if (file_assg !== null) {
      file = file_assg;
  } else if (file_papers !== null) {
      file = file_papers;
  } else if (file_material !== null) {
      file = file_material;
  }

  return file;
}

app.delete('/firstfiles_delete/:id',async(req,res)=>{
  const {id} =req.params;
  const file_assg = await first_year.Assignment.findById(id);
  const file_papers= await first_year.QuestionPaper.findById(id);
  const file_material=await first_year.StudyMaterial.findById(id);
  let file = null
  if (file_assg!==null){
    await first_year.Assignment.findByIdAndDelete(id);
  } 
  if (file_papers!==null){
    await first_year.QuestionPaper.findByIdAndDelete(id);
  } 
  if (file_material!==null){
    await first_year.StudyMaterial.findByIdAndDelete(id);
  } 
  res.redirect('/firstYear/allfiles')
  })
  

//______________________________________________________________________________________________________________________________________


// HOME


app.get('/', (req, res) => {
    res.render('home');
});

//___________________________________________________________________________________________
// SUBJECT HELPER

app.get('/sub_drop', (req, res) => {
      res.render('subhelp');
});

app.get('/quiz', (req, res) => {
  const topic = req.query.topic;
  console.log(topic);
  res.render('quiz', { topic });
});


//_______________________________________________________________________________________________________________________________

// CHAT ROOMS



app.get('/chats',(req,res)=>{
  res.render('index')
})
app.get('/chat',(req,res)=>{
  res.render('chat')
})





const {
  userJoin,
  getCurrentUser,
  userLeave,
  getRoomUsers,
} = require("./utils/users");

const formatMessage = require("./utils/messages");
const botName = "Community Chat";

// Run when client connects
io.on("connection", (socket) => {
  socket.on("joinRoom", ({ username, room }) => {
    const user = userJoin(socket.id, username, room);

    socket.join(user.room);

    // Welcome current user
    socket.emit("message", formatMessage(botName, "Welcome to ChatCord!"));

    // Broadcast when a user connects
    socket.broadcast
      .to(user.room)
      .emit(
        "message",
        formatMessage(botName, `${user.username} has joined the chat`)
      );

    // Send users and room info
    io.to(user.room).emit("roomUsers", {
      room: user.room,
      users: getRoomUsers(user.room),
    });
  });

  // Listen for chatMessage
  socket.on("chatMessage", (msg) => {
    const user = getCurrentUser(socket.id);

    io.to(user.room).emit("message", formatMessage(user.username, msg));
  });

  // Runs when client disconnects
  socket.on("disconnect", () => {
    const user = userLeave(socket.id);

    if (user) {
      io.to(user.room).emit(
        "message",
        formatMessage(botName, `${user.username} has left the chat`)
      );

      // Send users and room info
      io.to(user.room).emit("roomUsers", {
        room: user.room,
        users: getRoomUsers(user.room),
      });
    }
  });
});


app.get('/extract',(req,res)=>{
  res.render('extract');
})

server.listen(3000, () => {
    console.log('Serving on port 3000');
});
