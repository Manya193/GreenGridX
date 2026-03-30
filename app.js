const express = require("express");
const app = express();
const mongoose = require("mongoose");
const User = require("./Models/user");
const Energy = require("./Models/energy");
const Transaction = require("./Models/transaction");
const bcrypt = require("bcrypt");
require("dotenv").config();

app.use(express.urlencoded({ extended: true }));
app.set("view engine", "ejs");
app.use(express.static("public"));

//  MongoDB Atlas Connection
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("MongoDB Atlas Connected "))
.catch(err => console.log(err));

const session = require("express-session");

app.use(session({
  secret: process.env.SESSION_SECRET,   // anything
  resave: false,
  saveUninitialized: true
}));

function predictDemand(transactions) {

  if (transactions.length === 0) return 20;

  const total = transactions.reduce(
    (sum, t) => sum + t.energyPurchased,
    0
  );

  return total / transactions.length;
}

function adjustDemandByTime(baseDemand, time) {

  if (time.toLowerCase() === "evening") return baseDemand * 1.5;
  if (time.toLowerCase() === "morning") return baseDemand * 0.8;
  if (time.toLowerCase() === "night") return baseDemand * 0.6;

  return baseDemand;
}

// Basic route
app.get("/", (req, res) => {
  res.render("home");
});

// Start server
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


app.post("/register", async (req, res) => {
  try {
    const existingUser = await User.findOne({ email: req.body.email });

    if (existingUser) {
      return res.redirect("/?error=User already exists");
    }

    // HASH PASSWORD
    const hashedPassword = await bcrypt.hash(req.body.password, 10);

    const newUser = new User({
      name: req.body.name,
      email: req.body.email,
      password: hashedPassword,
      role: req.body.role,
      location: req.body.location
    });

    await newUser.save();

   
    req.session.userId = newUser._id;

    //  REDIRECT BASED ON ROLE
    if (newUser.role === "producer") {
      res.redirect("/producer-dashboard");
    } else {
      res.redirect("/buyer-dashboard");
    }

  } catch (err) {
    console.log(err);
    res.send("Error occurred ❌");
  }
});


app.post("/login", async (req, res) => {

  const user = await User.findOne({ email: req.body.email });

  if (!user) {
  return res.redirect("/?error=Invalid credentials");
  }

  const isMatch = await bcrypt.compare(req.body.password, user.password);

  if (!isMatch) {
    return res.redirect("/?error=Invalid credentials");
  }

  req.session.userId=user._id;

  if (user.role === "producer") {
    return res.redirect("/producer-dashboard");
  } else {
    return res.redirect("/buyer-dashboard");
  }

});
app.get("/producer-dashboard", async (req, res) => {

  if (!req.session.userId) {
    return res.redirect("/");
  }

  const userId = req.session.userId.toString();   // ✅ FIXED (important)

  // 1. Listings
  const listings = await Energy.find({ producerId: userId });

  const availableListings = listings.filter(e => e.status === "available");

  // 2. Transactions (✅ FIXED)
  const transactions = await Transaction.find({ producerId: userId });

  

  // 3. Total Energy Listed
  const totalEnergy = listings.reduce(
    (sum, item) => sum + item.energyAmount,
    0
  );

  // 4. Energy Sold
  const energySold = transactions.reduce(
    (sum, t) => sum + (t.energyPurchased || 0),
    0
  );

  const progress = totalEnergy > 0
    ? Math.round((energySold / totalEnergy) * 100)
    : 0;

  // 5. Total Earnings
  const totalEarnings = transactions.reduce(
    (sum, t) => sum + (t.totalPrice || 0),
    0
  );

  // 6. ENERGY DISTRIBUTION (ONLY AVAILABLE LISTINGS)
  let morning = 0, afternoon = 0, evening = 0;

  availableListings.forEach(item => {
    if (item.time === "morning") morning += item.energyAmount;
    if (item.time === "afternoon") afternoon += item.energyAmount;
    if (item.time === "evening") evening += item.energyAmount;
  });

  // 7. WEEKLY EARNINGS (FIXED DATE FIELD)
  let weeklyEarnings = [0,0,0,0,0,0,0];

  transactions.forEach(t => {
    if (!t.date) return;  // safety check

    const day = new Date(t.date).getDay();  // ✅ correct field
    weeklyEarnings[day] += t.totalPrice || 0;
  });

  

  // 8. DEMAND PREDICTION
  const baseDemand = predictDemand(transactions);

  const demandData = [
    Math.floor(adjustDemandByTime(baseDemand, "morning")),
    Math.floor(adjustDemandByTime(baseDemand, "afternoon")),
    Math.floor(adjustDemandByTime(baseDemand, "evening"))
  ];

  // AI display
  const predictedDemand = Math.floor(baseDemand);

  const times = ["Morning", "Afternoon", "Evening"];
  const maxIndex = demandData.indexOf(Math.max(...demandData));
  const predictedTime = times[maxIndex];

  const recommendedPrice = (5 + baseDemand * 0.02).toFixed(2);

  const carbonCredits = (energySold * 0.92).toFixed(2);

  // FINAL RENDER
  res.render("producer-dashboard", {
    listings,
    availableListings,
    totalEnergy,
    energySold,
    totalEarnings,
    predictedDemand,
    predictedTime,
    recommendedPrice,
    progress,
    morning,
    afternoon,
    evening,
    weeklyEarnings,
    demandData,
    carbonCredits,
    transactions 
  });

});


app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});
app.get("/buyer-dashboard", async (req, res) => {
  res.set("Cache-Control", "no-store");

  if (!req.session.userId) {
    return res.redirect("/");
  }

  const userId = req.session.userId;

  // 1. GET ALL AVAILABLE LISTINGS
  const energies = await Energy.find({ status: "available" });

  // 2. PRICE CALCULATIONS
  const prices = energies.map(e => Number(e.price));

  const avgPrice = prices.length
    ? (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2)
    : 0;

  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;

  let suggestion = "Wait for better prices";

  if (minPrice > 0 && avgPrice > minPrice) {
    suggestion = "Buy now to save cost";
  }

  // 3. BEST TIME
  let timeCount = { morning: 0, afternoon: 0, evening: 0 };

  energies.forEach(e => {
    if (e.time === "morning") timeCount.morning++;
    if (e.time === "afternoon") timeCount.afternoon++;
    if (e.time === "evening") timeCount.evening++;
  });

  const bestTime = Object.keys(timeCount).reduce((a, b) =>
    timeCount[a] > timeCount[b] ? a : b
  );

  // 4. PRICE DISTRIBUTION
  let priceDistribution = [0, 0, 0, 0];

  energies.forEach(e => {
    if (e.price < 6) priceDistribution[0]++;
    else if (e.price < 7) priceDistribution[1]++;
    else if (e.price < 8) priceDistribution[2]++;
    else priceDistribution[3]++;
  });

  // 5. ENERGY BY TIME
  let morning = 0, afternoon = 0, evening = 0;

  energies.forEach(e => {
    if (e.time === "morning") morning += e.energyAmount;
    if (e.time === "afternoon") afternoon += e.energyAmount;
    if (e.time === "evening") evening += e.energyAmount;
  });

  // 6. DEMAND vs SUPPLY (GLOBAL - KEEP SAME)
  const transactions = await Transaction.find();

  const totalDemand = transactions.reduce(
    (sum, t) => sum + t.energyPurchased,
    0
  );

  const totalSupply = energies.reduce(
    (sum, e) => sum + e.energyAmount,
    0
  );

  //  7. USER TRANSACTIONS (ONLY ADDITION)
  const userTransactions = await Transaction.find({ buyerId: userId });

  const totalPurchased = userTransactions.reduce(
    (sum, t) => sum + t.energyPurchased,
    0
  );

  const buyerCarbonCredits = (totalPurchased * 0.92).toFixed(2);

  // FINAL RENDER
  res.render("buyer-dashboard", {
    energies,
    prices,
    avgPrice,
    minPrice,
    maxPrice,
    bestTime,
    priceDistribution,
    morning,
    afternoon,
    evening,
    totalSupply,
    totalDemand,
    suggestion,
    buyerCarbonCredits,
    transactions: userTransactions   //  for modal
  });
});

app.get("/add-energy", async (req, res) => {

  const transactions = await Transaction.find();

  const selectedTime = "evening"; // default display

  const baseDemand = predictDemand(transactions);

  const predictedDemand = adjustDemandByTime(baseDemand, selectedTime);

  // optional recommended price
  const recommendedPrice = (5 + predictedDemand * 0.02).toFixed(2);

  res.render("add-energy", {
    predictedDemand,
    selectedTime,
    recommendedPrice
  });

});

app.post("/add-energy", async (req, res) => {

  const supply = Number(req.body.energyAmount);
  const time = req.body.time;

  // Fetch transactions (for analytics / future use)
  const transactions = await Transaction.find();

  // Predict demand (optional - not used for price now)
  const baseDemand = predictDemand(transactions);
  const predictedDemand = adjustDemandByTime(baseDemand, time);

  // IMPORTANT: Producer sets price
  const price = Number(req.body.price);

  const newEnergy = new Energy({
    producerId: req.session.userId,
    energyAmount: supply,
    price: price,
    location: req.body.location,
    time: time
  });

  await newEnergy.save();

  res.redirect("/producer-dashboard");

});
app.get("/marketplace", async (req, res) => {

  const energies = await Energy.find({ status: "available" });

  res.render("marketplace", { energies });

});

app.get("/buy/:id", async (req, res) => {

  const energy = await Energy.findById(req.params.id);

  // ❌ If already sold or not found
  if (!energy || energy.status === "sold") {
    return res.send("Energy not available");
  }

  //  Mark as sold
  energy.status = "sold";
  await energy.save();

  //  Create transaction 
  const newTransaction = new Transaction({
    buyerId: req.session.userId,        
    producerId: energy.producerId,    
    listingId: energy._id,
    energyPurchased: energy.energyAmount,
    price: Number(energy.price),
    totalPrice:Number(energy.price)*energy.energyAmount   
  });

  await newTransaction.save();

  res.redirect("/buyer-dashboard");
});
app.get("/admin-login", (req, res) => {
  res.render("admin-login");
});

app.post("/admin-login", (req, res) => {

  const enteredPassword = req.body.password;

  const ADMIN_PASSWORD = "admin123"; 

  if (enteredPassword === ADMIN_PASSWORD) {
    res.redirect("/dashboard");
  } else {
    res.send("Incorrect password ❌");
  }

});

function predictDemand(transactions) {

  if (transactions.length === 0) return 20;

  const totalDemand = transactions.reduce(
    (sum, t) => sum + t.energyPurchased,
    0
  );

  const avgDemand = totalDemand / transactions.length;

  // Add growth factor
  const predictedDemand = avgDemand * 1.2;

  return predictedDemand;
}

app.get("/dashboard", async (req, res) => {

  // Transactions data
  const transactions = await Transaction.find();

  const totalEnergy = transactions.reduce(
    (sum, t) => sum + t.energyPurchased,
    0
  );

  const transactionCount = transactions.length;

  // Available supply
  const listings = await Energy.find({ status: "available" });

  const totalSupply = listings.reduce(
    (sum, e) => sum + e.energyAmount,
    0
  );

  const avgPrice =
    listings.length > 0
      ? (
          listings.reduce((sum, e) => sum + e.price, 0) /
          listings.length
        ).toFixed(2)
      : 0;

    

    const predictedDemand = predictDemand(transactions);

  res.render("dashboard", {
    totalEnergy,
    transactionCount,
    totalSupply,
    avgPrice,
    predictedDemand
 });

});

