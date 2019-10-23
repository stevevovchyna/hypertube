const express = require("express");
const router = express.Router({
	mergeParams: true
});
const passport = require("passport");
const User = require("../models/user");
const middleware = require("../middleware");
const async = require("async");
const xss = require("xss");
const mongoose = require('mongoose');
const DateOnly = require('mongoose-dateonly')(mongoose);
const loginRegExp = RegExp("^[a-zA-Z0-9_-]{3,20}$");
const nameRegExp = RegExp("^[a-zA-Z0-9 _-]{2,50}$");
const emailRegExp = RegExp("^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$");
const passwordRegExp = RegExp("(?!^[0-9]*$)(?!^[a-zA-Z]*$)^([a-zA-Z0-9]{6,15})$");
const bioRegExp = RegExp("^[A-Za-z0-9 .'?!,@$#-_\n\r]{5,300}$");
const tagRegExp = RegExp("^[A-Za-z0-9 ]{2,300}$");

var multer = require('multer');

var storage = multer.diskStorage({
	filename: function (req, file, callback) {
		callback(null, Date.now() + file.originalname);
	}
});
var imageFilter = function (req, file, cb) {
	// accept image files only
	if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/i)) {
		return cb(new Error('Only image files are allowed!'), false);
	}
	cb(null, true);
};
var upload = multer({
	storage: storage,
	fileFilter: imageFilter
})

var cloudinary = require('cloudinary');
cloudinary.config({
	cloud_name: process.env.CLOUDINARY_NAME,
	api_key: process.env.CLOUDINARY_API_KEY,
	api_secret: process.env.CLOUDINARY_API_SECRET
});

router.get("/:id", middleware.isLoggedIn, (req, res) => {
	User.findById(req.params.id, (err, foundUser) => {
		if (err || !foundUser) {
			console.log(err);
			req.flash('error', "User not found");
			res.redirect('back');
		} else {
			res.render('profiles/profile', {
				user: foundUser
			});
		}
	});
});

router.get("/:id/edit", middleware.checkProfileOwnership, (req, res) => {
	User.findById(req.params.id).exec((err, user) => {
		if (!user || err) {
			req.flash("error", "Invalid link!");
			console.log(err);
			return res.redirect("back");
		} else {
			res.render("profiles/edit", {
				user: user
			});
		}
	});
});

router.put("/:id/editinfo", middleware.checkProfileOwnership, middleware.checkIfOAuth, middleware.checkDuplicateInputData, (req, res) => {
	var username = req.sanitize(req.body.user.username);
	var firstname = req.sanitize(req.body.user.firstname);
	var lastname = req.sanitize(req.body.user.lastname);
	var bio = req.sanitize(req.body.user.bio);
	var email = req.sanitize(req.body.user.email);
	var language = req.sanitize(req.body.user.language);
	if (firstname === "" || lastname === "" || bio === "" || !firstname || !lastname || !bio || !language) {
		req.flash('error', "Fields can't be empty");
		res.redirect('back');
	} else {
		User.findByIdAndUpdate(req.params.id, {
			username: username,
			firstname: firstname,
			lastname: lastname,
			bio: bio,
			language: language
		}, (err, userdata) => {
			if (err) {
				console.log(err);
				req.flash("error", err.message);
				res.redirect("back");
			} else {
				if (!res.locals.oauth) {
					userdata.email = email;
					userdata.save((err) => {
						if (err) {
							console.log(err);
							req.flash("error", err.message);
							res.redirect("back");
						} else {
							req.flash("success", "Profile info updated!");
							res.redirect("/profile/" + req.params.id + "/edit");
						}
					});
				} else {
					req.flash("success", "Profile info updated!");
					res.redirect("/profile/" + req.params.id + "/edit");
				}
			}
		});
	}
});


router.put("/:id/addpic", middleware.checkProfileOwnership, upload.single('image'), middleware.pictureIsPresent, (req, res) => {
	async.waterfall([
		(done) => {
			User.findById(req.params.id, (err, user) => {
				if (err) {
					req.flash("error", err.message);
					console.log(err);
					res.redirect("back");
				}
				if (user.pictures.length == 5) {
					req.flash("error", "Max 5 pictures uploaded - delete one of the pictures to upload a new one!");
					return res.redirect("/profile/" + req.params.id + "/edit");
				} else {
					done();
				}
			});
		}, (done) => {
			cloudinary.uploader.upload(req.file.path, (result) => {
				User.findByIdAndUpdate(req.params.id, req.body.user, (err, user) => {
					if (err) {
						req.flash("error", err.message);
						console.log(err);
						res.redirect("back");
					} else {
						if (user.pictures.length == 0) {
							user.pictures.push({
								isProfile: true,
								url: result.secure_url,
								naked_url: result.public_id
							});
						} else {
							user.pictures.push({
								url: result.secure_url,
								naked_url: result.public_id
							});
						}
						user.save((err) => {
							if (err) {
								console.log(err);
								req.flash("error", err.message);
								res.redirect('back');
							} else {
								req.flash("success", "Picture was added!");
								res.redirect("/profile/" + req.params.id + "/edit");
							}
						});
					}
				});
			});
		}
	], (err) => {
		if (err) return next(err);
		res.redirect("back");
	});
});

router.delete("/:id/:pic_id/picdel", middleware.checkProfileOwnership, (req, res) => {
	User.findById(req.params.id, (err, user) => {
		if (err || !user) {
			req.flash("error", err.message);
			console.log(err);
			res.redirect("back");
		} else {
			// getting picture object without possibility to modify it as mongoose object
			var url = user.pictures.id(req.sanitize(req.params.pic_id));
			if (url) {
				var deletedPicture = user.pictures.filter(picture => picture._id.toString() === req.params.pic_id.toString());
				user.pictures.pull(req.params.pic_id);
				if (user.pictures[0]) {
					user.pictures[0].isProfile = true;
				}
				user.save(() => {
					if (deletedPicture[0].naked_url) {
						cloudinary.v2.api.delete_resources([url.naked_url], (err, result) => {
							if (err) {
								req.flash("error", err.message);
								console.log(err);
								res.redirect("back");
							}
						});
					}
					req.flash("success", "Picture deleted!");
					res.redirect("back");
				});
			} else {
				req.flash('error', "Picture not found");
				res.redirect('back');
			}
		}
	});
});

router.put("/:id/:pic_id/setprofile", middleware.checkProfileOwnership, (req, res) => {
	User.findById(req.params.id, (err, user) => {
		if (err || !user) {
			req.flash("error", "User not found");
			console.log(err);
			res.redirect("back");
		} else {
			var pictureIDChecker = user.pictures.filter(picture => picture._id.toString() === req.params.pic_id.toString());
			if (pictureIDChecker.length > 0) {
				user.pictures.forEach(pic => {
					pic.isProfile = false;
				});
				user.pictures.id(req.params.pic_id).isProfile = true;
				user.save(() => {
					req.flash("success", "Profile picture set!");
					res.redirect("back");
				});
			} else {
				req.flash('error', 'Picture not found');
				res.redirect('back');
			}
		}
	});
});

router.put("/:id/setpassword", middleware.checkIfLocal, middleware.checkProfileOwnership, (req, res) => {
	if (!req.body.password || !req.body.confirm) {
		req.flash("error", "Empty fields! Please, fill in both fields!");
		return res.redirect('back');
	} else if (!passwordRegExp.test(req.body.password) || !passwordRegExp.test(req.body.confirm)) {
		req.flash("error", "Please make sure your password contains at least 6 characters, 1 digit and 1 letter of any register");
		return res.redirect("back");
	} else {
		User.findById(req.sanitize(req.params.id), (err, foundUser) => {
			if (err) {
				console.log(err);
				req.flash('error', err.message);
				res.redirect('/profile/' + req.user._id + '/edit')
			} else {
				if (req.sanitize(req.body.password) === req.sanitize(req.body.confirm)) {
					var pass = req.sanitize(req.body.password);
					foundUser.setPassword(pass, (err) => {
						if (err) {
							console.log(err);
							req.flash('error', err.message);
							res.redirect('/profile/' + req.user._id + '/edit');
						} else {
							foundUser.save((err) => {
								if (err) {
									console.log(err);
									req.flash('error', err.message);
									res.redirect('/profile/' + req.user._id + '/edit');
								} else {
									req.flash('success', "You password has been changed");
									res.redirect('back');
								}
							});
						}
					})
				} else {
					req.flash("error", "Passwords do not match.");
					return res.redirect('back');
				}
			}
		});
	}
});

module.exports = router;
