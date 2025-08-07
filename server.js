const natural = require("natural");
const tokenizer = new natural.WordTokenizer();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const admin = require("firebase-admin");
const dotenv = require("dotenv");
const nodemailer = require("nodemailer");

// Load environment variables
dotenv.config();

// Initialize Firebase Admin SDK
const serviceAccount = require("./firebaseConfig.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const app = express();

// ✅ CORS Configuration - Allow all origins for development
app.use(cors({
    origin: "*", // Allow all origins for development
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"]
}));

app.use(express.json());
app.use(bodyParser.json());

// ✅ Email Configuration
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: "noreply.foundify@gmail.com",
        pass: "eoyh hekt csgh wlot" // Use App Password here
    }
});

/* ======================= 🔐 AUTH ROUTES ======================= */

// ✅ Signup
app.post("/signup", async (req, res) => {
    console.log("📥 Signup request received:", req.body);
    
    const { email, password, fullName, phone } = req.body;
    
    // Validate required fields
    if (!email || !password || !fullName || !phone) {
        console.log("❌ Missing required fields");
        return res.status(400).json({ error: "All fields are required" });
    }
    
    try {
        // Create user in Firebase Auth
        const userRecord = await admin.auth().createUser({ 
            email, 
            password,
            displayName: fullName 
        });
        
        // Store additional user data in Firestore
        await db.collection("users").doc(userRecord.uid).set({
            fullName,
            email,
            phone,
            password, // Note: In production, don't store plain passwords
            createdAt: new Date(),
        });
        
        console.log("✅ User registered successfully:", userRecord.uid);
        res.status(201).json({ 
            message: "User registered successfully!", 
            uid: userRecord.uid 
        });
        
    } catch (error) {
        console.error("❌ Signup error:", error.message);
        res.status(400).json({ error: error.message });
    }
});

// ✅ Login
app.post("/login", async (req, res) => {
    console.log("📥 Login request received:", req.body);
    
    const { email, password } = req.body;
    
    if (!email || !password) {
        console.log("❌ Missing email or password");
        return res.status(400).json({ error: "Email and password are required" });
    }
    
    try {
        // Get user by email
        const user = await admin.auth().getUserByEmail(email);
        
        // Get user document from Firestore
        const userDoc = await db.collection("users").doc(user.uid).get();
        
        if (!userDoc.exists) {
            console.log("❌ User document not found");
            return res.status(404).json({ error: "User not found" });
        }

        const userData = userDoc.data();
        const storedPassword = userData.password;
        
        // Check password (In production, use proper password hashing)
        if (storedPassword !== password) {
            console.log("❌ Incorrect password");
            return res.status(401).json({ error: "Incorrect password" });
        }

        console.log("✅ Login successful:", user.uid);
        res.status(200).json({ 
            message: "Login successful", 
            uid: user.uid,
            user: {
                email: userData.email,
                fullName: userData.fullName
            }
        });
        
    } catch (error) {
        console.error("❌ Login error:", error.message);
        if (error.code === 'auth/user-not-found') {
            res.status(404).json({ error: "User not found" });
        } else {
            res.status(400).json({ error: "Login failed" });
        }
    }
});

/* ======================= 📦 LOST & FOUND ROUTES ======================= */

// ✅ Report Lost Item
app.post("/lost-item", async (req, res) => {
    console.log("📥 Lost item report:", req.body);
    
    const { itemName, description, location, date, contact } = req.body;
    
    if (!itemName || !description || !location || !date || !contact) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const docRef = await db.collection("lost_items").add({
            itemName, 
            description, 
            location, 
            date, 
            contact,
            status: "Lost",
            createdAt: new Date(),
        });
        
        console.log("✅ Lost item reported:", docRef.id);
        res.status(201).json({ 
            message: "Lost item reported successfully!",
            id: docRef.id 
        });
        
    } catch (err) {
        console.error("❌ Lost item error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// ✅ Report Found Item
app.post("/found-item", async (req, res) => {
    console.log("📥 Found item report:", req.body);
    
    const { itemName, description, location, date, contact } = req.body;
    
    if (!itemName || !description || !location || !date || !contact) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        const docRef = await db.collection("found_items").add({
            itemName, 
            description, 
            location, 
            date, 
            contact,
            status: "Found",
            createdAt: new Date(),
        });
        
        console.log("✅ Found item reported:", docRef.id);
        res.status(201).json({ 
            message: "Found item reported successfully!",
            id: docRef.id 
        });
        
    } catch (err) {
        console.error("❌ Found item error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

/* ======================= 🔍 MATCHING LOGIC ======================= */

// ✅ Match Found Item and Notify
app.post("/match-found-item", async (req, res) => {
    console.log("📥 Match found item:", req.body);
    
    const { itemName, description, location, date, contact } = req.body;
    
    if (!itemName || !description || !location || !date || !contact) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        // Add found item
        await db.collection("found_items").add({
            itemName, description, location, date, contact,
            status: "Found",
            createdAt: new Date(),
        });

        // Search for matching lost items
        const lostItemsSnapshot = await db.collection("lost_items").get();
        let bestMatch = null;
        let highestSimilarity = 0;

        lostItemsSnapshot.forEach((doc) => {
            const lostItem = doc.data();
            if (!lostItem.description || !lostItem.contact) return;

            // Simple text matching algorithm
            const foundTokens = description.toLowerCase().split(" ");
            const lostTokens = lostItem.description.toLowerCase().split(" ");
            const commonWords = foundTokens.filter(word => lostTokens.includes(word));
            const similarity = commonWords.length / Math.max(foundTokens.length, lostTokens.length);

            if (similarity > 0.3 && similarity > highestSimilarity) {
                highestSimilarity = similarity;
                bestMatch = { ...lostItem, id: doc.id };
            }
        });

        if (bestMatch) {
            const mailOptions = {
                from: '"Foundify Support" <noreply.foundify@gmail.com>',
                to: bestMatch.contact,
                subject: "🔔 Possible Match for Your Lost Item!",
                text: `Hello,\n\nA potential match for your lost item (${bestMatch.itemName}) has been found!\n\nFound Details:\n- Item: ${itemName}\n- Location: ${location}\n- Date: ${date}\n- Contact: ${contact}\n\nPlease visit Foundify to verify and contact the finder.\n\nBest regards,\nFoundify Team`
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error("❌ Email error:", error);
                    return res.status(500).json({ error: "Email failed to send" });
                } else {
                    console.log("📩 Email sent:", info.response);
                    return res.status(200).json({ 
                        message: "✅ Match found! Email sent.",
                        similarity: highestSimilarity,
                        matchedItem: bestMatch.itemName
                    });
                }
            });
        } else {
            console.log("🔍 No match found");
            res.status(201).json({ message: "Found item added, but no match found." });
        }
    } catch (err) {
        console.error("❌ Match error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// ✅ Health check endpoint
app.get("/health", (req, res) => {
    res.status(200).json({ 
        message: "Server is running!", 
        timestamp: new Date().toISOString() 
    });
});

// ✅ Root endpoint
app.get("/", (req, res) => {
    res.status(200).json({ 
        message: "Foundify API Server", 
        version: "1.0.0",
        endpoints: [
            "POST /signup",
            "POST /login", 
            "POST /lost-item",
            "POST /found-item",
            "POST /match-found-item",
            "GET /health"
        ]
    });
});

// ✅ Error handling middleware
app.use((err, req, res, next) => {
    console.error("❌ Unhandled error:", err);
    res.status(500).json({ error: "Internal Server Error" });
});

// ✅ Start HTTP Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
    console.log(`✅ Server also accessible at http://127.0.0.1:${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`📋 API docs: http://localhost:${PORT}/`);
});