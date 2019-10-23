const express = require("express");
const router = express.Router();
const User = require("../models/user");
const Comments = require("../models/comments");
const middleware = require("../middleware");
const loginRegExp = RegExp("^[a-zA-Z0-9_-]{3,20}$");
const nameRegExp = RegExp("^[a-zA-Z0-9 _-]{2,50}$");
const emailRegExp = RegExp("^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$");
const passwordRegExp = RegExp("(?!^[0-9]*$)(?!^[a-zA-Z]*$)^([a-zA-Z0-9]{6,15})$");
const PirateBay = require('thepiratebay');
const fs = require('fs');
const YtsApi = require('yts-api-pt');
const yts = new YtsApi();
const axios = require('axios');
const xss = require('xss');
const bioRegExp = RegExp("^[A-Za-z0-9 .'?!,@$#-_\n\r]{5,300}$");
const TorrentSearchApi = require('torrent-search-api');

router.put("/yts/:movie_id/new", middleware.isLoggedIn, (req, res) => {
	if (/^\d+$/.test(req.params.movie_id)) {
		var comment = xss(req.body.comment_text);
		var movie_id = xss(req.params.movie_id);
		if (!bioRegExp.test(comment)) {
			return res.send({
				status: 'error',
				message: "Please make sure there's 5-300 alphanumerical characters in your comment and it doesn't contain special symbols apart from '.'?!,@$#-_' "
			});
		}
		if (comment !== "" && movie_id !== "" && parseInt(movie_id) > 0) {
			yts.getMovie({
					movieId: parseInt(movie_id)
				})
				.then(result => {
					if (result.data.movie.id == 0) {
						res.send({
							status: 'error',
							message: 'Oops! Something went wrong! Comment may be invalid'
						});
					} else {
						Comments.create({
							author: req.user._id,
							movie_id: movie_id,
							comment_text: comment
						}, (err, newComment) => {
							if (err) {
								console.log(err);
								res.send({
									status: 'error',
									message: err.message
								});
							} else {
								res.send({
									status: 'success',
									message: 'Comment added!',
									message_text: newComment.comment_text,
									author: req.user.username,
									author_id: req.user._id,
									comment_id: newComment._id
								});
							}
						});
					}
				})
				.catch(err => console.error(err));
		} else {
			res.send({
				status: 'error',
				message: 'Oops! Something went wrong! Comment may be invalid'
			});
		}
	} else {
		res.send({
			status: 'error',
			message: 'Invalid parameters!'
		});
	}
});

router.put("/1337x/:movie_id/new", middleware.isLoggedIn, async (req, res) => {

	var comment = xss(req.body.comment_text);
	var movie_id = xss(req.params.movie_id);
	if (!bioRegExp.test(comment)) {
		return res.send({
			status: 'error',
			message: "Please make sure there's 5-300 alphanumerical characters in your comment and it doesn't contain special symbols apart from '.'?!,@$#-_' "
		});
	} else if (comment !== "" && movie_id !== "") {
		try {
			var torrent = {};
			torrent.desc = Buffer.from(req.params.movie_id, 'base64').toString('ascii');
			torrent.provider = '1337x';
			const torrentHtmlDetail = await TorrentSearchApi.getTorrentDetails(torrent);
			if (torrentHtmlDetail == null) {
				console.log("Incorrect query!");
				res.send({
					status: 'error',
					message: 'Incorect query!'
				});
			} else {
				Comments.create({
					author: req.user._id,
					movie_id: movie_id,
					comment_text: comment
				}, (err, newComment) => {
					if (err) {
						console.log(err);
						res.send({
							status: 'error',
							message: err.message
						});
					} else {
						res.send({
							status: 'success',
							message: 'Comment added!',
							message_text: newComment.comment_text,
							author: req.user.username,
							author_id: req.user._id,
							comment_id: newComment._id
						});
					}
				});
			}
		} catch (e) {
			console.log(e);
			res.send({
				status: 'error',
				message: 'Oops! Something went wrong! Comment may be invalid'
			});
		}
	} else {
		res.send({
			status: 'error',
			message: 'Oops! Something went wrong! Comment may be invalid'
		});
	}
});

router.delete("/:movie_id/delete", middleware.isLoggedIn, middleware.checkCommentAuthorship, (req, res) => {
	Comments.findByIdAndDelete(req.body.comment_id, (err, deletedOne) => {
		if (err || !deletedOne) {
			console.log(err);
			res.send({
				status: "error",
				message: err.message
			});
		} else {
			res.send({
				status: 'success',
				message: "Comment deleted!",
				comment_id: deletedOne._id
			});
		}
	})
});

module.exports = router;
