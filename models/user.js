const mongoose = require("mongoose"),
passportLocalMongoose = require("passport-local-mongoose");

var UserSchema = new mongoose.Schema({
	intra_id: String,
	github_id: String,
	username: String,
	lastname: String,
	firstname: String,
	language: {
		type: String,
		default: 'English'
	},
	seenMovies: [{
		type: String
	}],
	bio: {
		type: String,
		default: "I'm a very interesting person!"
	},
	pictures: [{
		url: String,
		naked_url: String,
		isProfile: {
			type: Boolean,
			default: false
		}
	}],
	email: {
		type: String,
		unique: true
	},
	isVerified: {
		type: Boolean,
		default: false
	},
	password: String,
	passwordResetToken: String,
	passwordResetExpires: Date,
	createdAt: {
		type: Date,
		required: true,
		default: Date.now
	}
});

UserSchema.plugin(passportLocalMongoose, {
	usernameUnique: false,
	findByUsername: function (model, queryParameters) {
		queryParameters.isVerified = true;
		return model.findOne(queryParameters);
	}
});

//exporting model to the db
module.exports = mongoose.model("User", UserSchema);
