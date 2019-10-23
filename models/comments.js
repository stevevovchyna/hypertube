const mongoose = require("mongoose");

var CommentsSchema = new mongoose.Schema({
	createdAt: {
		type: Date,
		required: true,
		default: Date.now
	},
	author: {
		type: mongoose.Schema.Types.ObjectId,
		ref: 'User'
	},
	movie_id: String,
	comment_text: String
});

//exporting model to the db
module.exports = mongoose.model("Comments", CommentsSchema);
