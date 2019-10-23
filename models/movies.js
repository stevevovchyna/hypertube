const mongoose = require("mongoose");

var MoviesSchema = new mongoose.Schema({
	movie_id: String,
	path: String,
	hash: String,
	filesize: Number,
	lastSeen: {
		type: Date
	},
	fullyUploaded: {
		type: Boolean,
		default: false
	},
	createdAt: {
		type: Date,
		required: true,
		default: Date.now
	}
});

//exporting model to the db
module.exports = mongoose.model("Movies", MoviesSchema);
