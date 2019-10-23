const User = require("../models/user");
const Movies = require("../models/movies");
const Comments = require("../models/comments");
const xss = require("xss");
const loginRegExp = RegExp("^[a-zA-Z0-9_-]{3,20}$");
const nameRegExp = RegExp("^[a-zA-Z0-9 _-]{2,50}$");
const emailRegExp = RegExp("^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$");
const bioRegExp = RegExp("^[A-Za-z0-9 .'?!,@$#-_\n\r]{5,300}$");
const rimraf = require("rimraf");
const Xray = require('x-ray-scraper/Xray');
const x = Xray();
const YtsApi = require('yts-api-pt');
const yts = new YtsApi();
const fs = require('fs');
const parseTorrent = require('parse-torrent');
const OS = require('opensubtitles-api');
const OpenSubtitles = new OS({
	useragent: 'TemporaryUserAgent',
	username: process.env.SUBS_USERNAME,
	password: process.env.SUBS_PASSWORD,
	ssl: true
});
const u = require('./utils');
const TorrentSearchApi = require('torrent-search-api');
const pump = require('pump');
const torrentStream = require('torrent-stream');
const nodePath = require('path');
const ps = require('ps-node');
const stream = require('stream');

var middlewareObject = {};

middlewareObject.pauseAllTorrents = (req, res, next) => {
	next();
}

middlewareObject.checkIfYTSDownloaded = async (req, res, next) => {
	Movies.findOne({
		movie_id: req.params.movie_id,
		hash: req.params.hash
	}, (err, foundMovie) => {
		if (!foundMovie) {
			next();
		} else {
			if (foundMovie.fullyUploaded == false || req.useragent.isFirefox == true) {
				next();
			} else {
				try {
					foundMovie.lastSeen = Date.now();
					foundMovie.save();
					const path = foundMovie.path;
					const stat = fs.statSync(path);
					const fileSize = stat.size;
					const range = req.headers.range;
					const ext = nodePath.parse(foundMovie.path).ext.substr(1);
					if (range) {
						const parts = range.replace(/bytes=/, "").split("-");
						var start = parseInt(parts[0], 10);
						var end = fileSize - 1;
						if (start > end) {
							start = 0;
						}
						const chunksize = (end - start) + 1;
						const file = fs.createReadStream(path, {
							start,
							end
						})
						const head = {
							'Content-Range': `bytes ${start}-${end}/${fileSize}`,
							'Accept-Ranges': 'bytes',
							'Content-Length': chunksize,
							'Content-Type': 'video/' + ext,
						}
						res.writeHead(206, head);
						pump(file, res);
					} else {
						const head = {
							'Content-Length': fileSize,
							'Content-Type': 'video/mp4',
						}
						res.writeHead(200, head)
						const file = createReadStream(path);
						pump(file, res)
					}
				} catch (e) {
					console.log(e);
				}
			}
		}
	});
}

middlewareObject.checkIfDownloaded = async (req, res, next) => {
	try {
		var torrent = {};
		torrent.desc = Buffer.from(req.params.desc, 'base64').toString('ascii');
		torrent.provider = '1337x';
		torrent.magnet = await x(encodeURI(torrent.desc), 'a[href*="magnet:?xt=urn:btih:"]@href')();
		const torrentHtmlDetail = await TorrentSearchApi.getTorrentDetails(torrent);
		torrent.title = await x(torrentHtmlDetail, 'h1')();
		torrent.encodedMagnet = await Buffer.from(torrent.magnet).toString('base64');
		Movies.findOne({
			movie_id: req.params.desc,
			hash: torrent.encodedMagnet
		}, (err, foundMovie) => {
			if (!foundMovie) {
				next();
			} else {
				if (foundMovie.fullyUploaded == false || req.useragent.isFirefox == true) {
					next();
				} else {
					try {
						foundMovie.lastSeen = Date.now();
						foundMovie.save();
						const path = foundMovie.path;
						const stat = fs.statSync(path);
						const fileSize = stat.size;
						const range = req.headers.range;
						const ext = nodePath.parse(foundMovie.path).ext.substr(1);
						if (range) {
							const parts = range.replace(/bytes=/, "").split("-");
							var start = parseInt(parts[0], 10);
							var end = fileSize - 1;
							if (start > end) {
								start = 0;
							}
							const chunksize = (end - start) + 1;
							const file = fs.createReadStream(path, {
								start,
								end
							})
							const head = {
								'Content-Range': `bytes ${start}-${end}/${fileSize}`,
								'Accept-Ranges': 'bytes',
								'Content-Length': chunksize,
								'Content-Type': 'video/' + ext,
							}
							res.writeHead(206, head);
							pump(file, res);
						} else {
							const head = {
								'Content-Length': fileSize,
								'Content-Type': 'video/mp4',
							}
							res.writeHead(200, head)
							const file = createReadStream(path);
							pump(file, res)
						}
					} catch (e) {
						console.log(e);
						res.sendStatus(204);
					}
				}
			}
		});
	} catch (e) {
		console.log(e);
		res.sendStatus(204);
	}
}

middlewareObject.checkSortInput = async (req, res, next) => {
	const query = xss(req.body.query);
	const type = xss(req.body.sortType);
	const order = xss(req.body.sortOrder);
	const year = {
		min: parseInt(xss(req.body.year.min)),
		max: parseInt(xss(req.body.year.max))
	};
	const rating = {
		min: parseInt(xss(req.body.rating.min)),
		max: parseInt(xss(req.body.rating.max))
	}
	if ((type == 'title' || type == 'year' || type == 'rating' ||
			type == 'peers' || type == 'seeds') &&
		(order == 'desc' || order == 'asc') && query !== '' &&
		(year.min >= 1900 && year.min <= year.max && year.max <= 2020) &&
		(rating.min >= 0 && rating.min <= rating.max && rating.max <= 10)) {
		next();
	} else {
		res.send({
			status: 'error',
			message: "Incorrect input!"
		});
	}
}

middlewareObject.checkIfVideoIsPlayable = async (req, res, next) => {
	const path = 'TorrentFiles/' + req.params.hash + '.torrent';
	var tor = {};
	var count = 0;
	try {
		tor = await parseTorrent(fs.readFileSync(path));
	} catch (e) {
		console.log(e);
	}
	if (tor.files) {
		for (let file of tor.files) {
			const extension = await u.getFileExtension(file.name);
			if (extension == 'mp4' || extension == 'mkv' || extension == 'ogg') {
				if (extension == 'mkv') {
					if (req.useragent.isFirefox) {
						res.locals.isFirefox = true;
					}
				}
				count += 1;
			}
		}
	}
	if (count > 0) {
		next();
	} else {
		res.sendStatus(204);
	}
}

middlewareObject.closeFFMPEG1337 = async (req, res, next) => {
	var desc = await Buffer.from(req.params.desc, 'base64').toString('ascii');
	var magnet = await x(encodeURI(desc), 'a[href*="magnet:?xt=urn:btih:"]@href')();
	const torInfo = await parseTorrent(magnet);
	const hash = torInfo.infoHash.toUpperCase();
	await ps.lookup({
		command: 'ffmpeg',
		arguments: 'videoid=' + hash + req.user._id
	}, function (err, resultList) {
		if (resultList.length > 0) {
			if (err) {
				throw new Error(err);
			}
			resultList.forEach((foundProcess) => {
				if (foundProcess) {
					ps.kill(foundProcess.pid, (err) => {
						if (err) {
							throw new Error(err);
						} else {
							console.log('Process %s has been killed!', foundProcess.pid);
						}
						console.log('PID: %s, COMMAND: %s, ARGUMENTS: %s', foundProcess.pid, foundProcess.command, foundProcess.arguments);
					});
				} else {
					console.log('me guuuuuusta')
				}
			});
		}
	});
	next();
}

middlewareObject.closeFFMPEG = async (req, res, next) => {
	await ps.lookup({
		command: 'ffmpeg',
		arguments: 'videoid=' + req.params.video_id + req.user._id
	}, (err, resultList) => {
		if (err) {
			throw new Error(err);
		}
		resultList.forEach((foundProcess) => {
			if (foundProcess) {
				ps.kill(foundProcess.pid, (err) => {
					if (err) {
						throw new Error(err);
					} else {
						console.log('Process %s has been killed!', foundProcess.pid);
					}
					console.log('PID: %s, COMMAND: %s, ARGUMENTS: %s', foundProcess.pid, foundProcess.command, foundProcess.arguments);
				});
			} else {
				console.log('me guuuuuusta')
			}
		});
	});
	next();
}

middlewareObject.pictureIsPresent = (req, res, next) => {
	if (req.file == undefined) {
		req.flash('error', "Please choose a picture first!");
		res.redirect('back');
	} else {
		next();
	}
}

middlewareObject.downloadTorrentFile = async (req, res, next) => {
	if (/^\d+$/.test(req.params.video_id)) {
		var query = parseInt(xss(req.params.video_id));
		if (query <= 0) {
			req.flash('error', 'Incorrect query');
			res.redirect('/research');
		} else {
			yts.getMovie({
				movieId: query,
				withImages: true,
				withCast: true
			}).then(async (foundMovie) => {
				if (foundMovie.data.movie.id == 0) {
					req.flash('error', 'Incorrect query');
					res.redirect('/research');
				} else {
					await u.downloadTorrents(foundMovie.data.movie.torrents).then(() => {
						next();
					});
				}
			}).catch((e) => {
				if (e) {
					console.log(e);
					req.flash('error', 'This video is unavailable');
					res.redirect('/research');
				}
			});
		}
	} else {
		req.flash('error', 'Incorrect query');
		res.redirect('/research');
	}
}

middlewareObject.torrentValidation = async (req, res, next) => {
	try {
		const desc = await Buffer.from(req.params.desc, 'base64').toString('ascii');
		var magnet = await x(encodeURI(desc), 'a[href*="magnet:?xt=urn:btih:"]@href')();
		var engine = torrentStream(magnet, {
			path: res.locals.downPath,
			tmp: 'tmp'
		});
		var filePath = {};
		engine.on('ready', () => {
			engine.files = engine.files.sort(function (a, b) {
				return b.length - a.length
			}).slice(0, 1);
			engine.files.forEach(file => {
				var ext = nodePath.parse(file.name).ext;
				console.log(nodePath.parse(file.name).ext);
				if (ext == '.mp4' || ext == '.mkv' || ext == '.ogg') {
					filePath.filename = file.path;
					filePath.name = file.name;
					filePath.TmpDir = 'tmp/' + file.path;
				}
			});
			if (!u.isEmpty(filePath)) {
				OpenSubtitles.search({
					query: filePath.name
				}).then(async (subtitles) => {
					u.saveSubtitles(subtitles, filePath).then(async (subs) => {
						res.locals.subs = subs;
						return next();
					});
				}).catch(e => {
					if (e) {
						console.log(e);
					}
				});
			} else {
				console.log("Unsupported file type ;(");
				req.flash('error', 'Unsupported file type :(');
				res.redirect('/research');
			}
		});
	} catch (e) {
		console.log(e);
		req.flash('error', "Unsupported file type :(");
		return res.redirect('/research');
	}
}

middlewareObject.checkCommentAuthorship = (req, res, next) => {
	Comments.findById(req.body.comment_id, (err, foundComment) => {
		if (err) {
			console.log(err);
			res.send({
				status: "error",
				message: err.message
			});
		} else {
			if (foundComment.author.toString() === req.user._id.toString()) {
				next();
			} else {
				res.send({
					status: "error",
					message: "You don't have permission to do it!"
				});
			}
		}
	});
}

middlewareObject.checkDuplicateInputData = (req, res, next) => {
	if (!nameRegExp.test(req.body.user.firstname) || !nameRegExp.test(req.body.user.lastname) || !loginRegExp.test(req.body.user.username)) {
		req.flash("error", "Please make sure you've entered a correct username, First Name or Last Name");
		return res.redirect("back");
	} else if (!bioRegExp.test(req.body.user.bio)) {
		req.flash("error", "Please make sure there's 5-300 characters in your bio and it doesn't containt symbols apart from '.'?!,@$#-_' ");
		return res.redirect("back");
	} else if (!res.locals.oauth) {
		if (!emailRegExp.test(req.body.user.email)) {
			req.flash("error", "Please make sure you've entered a correct email address!");
			return res.redirect("back");
		}
	}
	var username = req.sanitize(req.body.user.username);
	var email = req.sanitize(req.body.user.email);
	User.findOne({
		username: username
	}, (err, usernamecheck) => {
		if (usernamecheck && usernamecheck._id.toString() !== req.user._id.toString()) {
			req.flash("error", "There's already a user with username " + username);
			return res.redirect("back");
		} else {
			if (!res.locals.oauth) {
				User.findOne({
					email: email
				}, (err, emailcheck) => {
					if (emailcheck && emailcheck._id.toString() !== req.user._id.toString()) {
						req.flash("error", "There's already a user with email address " + email);
						return res.redirect("back");
					} else {
						next();
					}
				});
			} else {
				next();
			}
		}
	});
}

middlewareObject.checkIfOAuth = (req, res, next) => {
	User.findById(req.params.id, (err, foundUser) => {
		if (err) {
			console.log(err);
			req.flash('error', err.message);
			res.redirect('back');
		} else {
			if (foundUser.intra_id || foundUser.github_id) {
				res.locals.oauth = true;
				next();
			} else {
				res.locals.oauth = false;
				next();
			}
		}
	});
}

middlewareObject.checkIfLogged = (req, res, next) => {
	if (req.isAuthenticated()) {
		res.redirect('/research');
	} else {
		next();
	}
}

middlewareObject.isLoggedIn = (req, res, next) => {
	if (req.isAuthenticated()) {
		return next();
	} else {
		req.flash("error", "Please login first");
		return res.redirect("/login");
	}
};

middlewareObject.ifVerified = (req, res, next) => {
	User.findOne({
		username: req.sanitize(req.body.username)
	}, (err, user) => {
		if (err || !user) {
			console.log(err);
			req.flash('error', 'User not found');
			res.redirect('/login');
		} else {
			if (user.isVerified) {
				return next();
			} else {
				req.flash("error", "User with this email is not verified yet. Please, check the inbox of " + user.email + " to go through the verification process.");
				res.redirect("/login");
			}
		}
	});
}

middlewareObject.checkIfLocal = (req, res, next) => {
	User.findById(req.params.id, (err, foundUser) => {
		if (err || !foundUser) {
			console.log(err);
			req.flash('error', "User not found");
			res.redirect('back');
		} else {
			if (foundUser.intra_id) {
				req.flash('error', "This feature is not supported in your account");
				res.redirect('back');
			} else {
				next();
			}
		}
	});
}

middlewareObject.checkProfileOwnership = (req, res, next) => {
	if (req.isAuthenticated()) {
		if (req.params.id == res.locals.currentUser._id) {
			next();
		} else {
			req.flash("error", "You don't have permission to do that");
			res.redirect("/research");
		}
	} else {
		req.flash("error", "You need to be logged in!");
		res.redirect("/research");
	}
};

module.exports = middlewareObject;
