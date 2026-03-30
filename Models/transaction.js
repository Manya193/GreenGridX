const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
  buyerId: String,
  producerId:String,
  listingId: String,
  energyPurchased: Number,
  totalPrice: Number,
  date: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Transaction", transactionSchema);