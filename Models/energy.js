const mongoose = require("mongoose");

const energySchema = new mongoose.Schema({
  producerId: String,
  energyAmount: Number,   // kWh
  price: Number,
  location: String,
  time: String,
  status: {
    type: String,
    default: "available"
  }
});

module.exports = mongoose.model("Energy", energySchema);