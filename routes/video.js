const express = require("express");
const router = express.Router();
const Comments = require("../models/comments");
const middleware = require("../middleware");
const fs = require('fs');
const User = require('../models/user');
const Movies = require('../models/movies');
const YtsApi = require('yts-api-pt');
const yts = new YtsApi();
const axios = require('axios');
const xss = require('xss');
const Xray = require('x-ray-scraper/Xray');
const x = Xray();
const torrentStream = require('torrent-stream');
const parseTorrent = require('parse-torrent');
const OS = require('opensubtitles-api');
const OpenSubtitles = new OS({
	useragent: 'TemporaryUserAgent',
	username: process.env.SUBS_USERNAME,
	password: process.env.SUBS_PASSWORD,
	ssl: true
});
const u = require('../middleware/utils');
const path = require('path');
const pump = require('pump');
const cmd = require('node-cmd');
const mainFileImport = require('../app.js');
const stream = require('stream');
const util = require('util');
const urlExists = util.promisify(require('url-exists'));
const nodePath = require('path');
const TorrentSearchApi = require('torrent-search-api');
const pretty = require('prettysize');

router.get("/yts/:video_id",
	middleware.isLoggedIn,
	middleware.downloadTorrentFile,
	middleware.closeFFMPEG,
	async (req, res) => {
		var query = parseInt(xss(req.params.video_id));
		yts.getMovie({
			movieId: query,
			withImages: true,
			withCast: true
		}).then(async (foundMovie) => {
			const omdbquery = 'http://www.omdbapi.com/?i=' + foundMovie.data.movie.imdb_code + '&apikey=' + process.env.OMDB_KEY;
			const omdb = await axios.get(omdbquery);
			const comments = await Comments.find({
				movie_id: req.params.video_id
			}).populate('author').exec();
			var screenshotsAvailability = {
				img1: true,
				img2: true,
				img3: true
			}
			screenshotsAvailability.img1 = await urlExists(foundMovie.data.movie.large_screenshot_image1);
			screenshotsAvailability.img2 = await urlExists(foundMovie.data.movie.large_screenshot_image2);
			screenshotsAvailability.img3 = await urlExists(foundMovie.data.movie.large_screenshot_image3);
			await res.render('video', {
				movie: foundMovie.data.movie,
				imdb_data: omdb.data,
				comments: comments,
				yts: true,
				screenshotsAvailability: screenshotsAvailability
			});
		}).catch((e) => {
			if (e) {
				console.log(e);
				req.flash('error', 'This video is unavailable');
				res.redirect('/research');
			}
		});
	});

router.get('/getytssubtitles/:movie_id',
	middleware.isLoggedIn,
	async (req, res) => {
		setTimeout(() => {
			if (/^\d+$/.test(req.params.movie_id) || parseInt(xss(req.params.movie_id)) <= 0) {
				var query = parseInt(xss(req.params.movie_id));
				yts.getMovie({
					movieId: query,
				}).then(async (foundMovie) => {
					if (foundMovie.data.movie.id == 0) {
						req.flash('error', 'Incorrect query');
						res.redirect('/research');
					} else {
						u.downloadSubtitles(foundMovie)
							.then(async (foundFilm) => {
								await res.send({
									status: 'success',
									movie: foundFilm
								});
							}).catch(e => {
								if (e) {
									console.log(e);
									res.send({
										status: 'error',
										message: 'No subtitles found'
									});
								}
							});
					}
				}).catch(e => {
					if (e) {
						console.log(e);
						res.send({
							status: 'error',
							message: 'No subtitles found'
						});
					}
				});
			} else {
				console.log('Invalid query');
				res.send({
					status: 'error',
					message: 'Invalid query'
				});
			}
		}, 5000);
	});

router.get("/streamyts/:hash.:movie_id",
	middleware.isLoggedIn,
	middleware.checkIfYTSDownloaded,
	middleware.checkIfVideoIsPlayable,
	async (req, res) => {
		try {
			User.findById(req.user._id, (err, foundUser) => {
				if (err || !foundUser) {
					console.log(err);
					res.sendStatus(204);
				} else {
					if (!foundUser.seenMovies.includes(req.params.movie_id.toString())) {
						foundUser.seenMovies.push(req.params.movie_id.toString());
						foundUser.save();
					}
				}
			});
			const torrentPath = 'TorrentFiles/' + req.params.hash + '.torrent';
			const tor = await parseTorrent(fs.readFileSync(torrentPath));
			const magnet = await parseTorrent.toMagnetURI(tor);
			var engine = torrentStream(magnet, {
				path: res.locals.downPath,
				tmp: 'tmp'
			});
			var fileToStream = {};
			const range = req.headers.range;
			var parts = range.replace(/bytes=/, "").split("-");
			var start = parseInt(parts[0], 10);
			engine.on('ready', () => {
				engine.files = engine.files.sort(function (a, b) {
					return b.length - a.length
				}).slice(0, 1);
				engine.files.forEach(async (file) => {
					var extension = u.getFileExtension(file.path);
					if (extension == 'mp4' || extension == 'ogg' || extension == 'mkv') {
						fileToStream = file;
						const path = res.locals.downPath + fileToStream.path;
						if ((extension == 'mp4' || extension == 'ogg' || extension == 'mkv') && !req.useragent.isFirefox) {
							var videoStream = file.createReadStream({
								start: start,
								end: file.length
							})
							u.stream_video(path, fileToStream, req, res, videoStream);
						} else if (extension == 'mkv' && req.useragent.isFirefox) {
							// CONVERTATION!!!!!!!!!!!!!!!!
							mainFileImport.eventSocket
								.to(req.user._id.toString())
								.emit('transcoding baby', {
									hash: req.params.hash
								});
							u.convertationAndStreaming(res, req, fileToStream, req.params.movie_id);
						}
						Movies.findOneAndUpdate({
							movie_id: req.params.movie_id,
							hash: req.params.hash
						}, {
							lastSeen: Date.now()
						}, (err, foundMovie) => {
							if (!foundMovie) {
								Movies.create({
									movie_id: req.params.movie_id,
									path: path,
									filesize: fileToStream.length,
									hash: req.params.hash,
									lastSeen: Date.now()
								})
							}
							if (err) {
								console.log(err);
								res.sendStatus(204);
							}
						});
					}
				});
			});
			engine.on('download', (pieceindex) => {
				process.stdout.write('#: ' + pieceindex + ' || Down: ' + (engine.swarm.downloaded / 1e+6).toFixed(2) + '/' + (fileToStream.length / 1e+6).toFixed(2));
				process.stdout.cursorTo(0);
			});
			engine.once('idle', async () => {
				var downloadedFile = {};
				engine.files = engine.files.sort(function (a, b) {
					return b.length - a.length
				}).slice(0, 1);
				engine.files.forEach((file) => {
					var extension = u.getFileExtension(file.path);
					if (extension == 'mp4' || extension == 'mkv' || extension == 'ogg') {
						downloadedFile = file;
					}
				});
				cmd.get(
					'ffmpeg -v error -sseof -60 -i "' + res.locals.downPath + downloadedFile.path + '" -f null -',
					(err, data, stderr) => {
						if (stderr) {
							console.log('\nDownload is still in progress!')
						} else {
							Movies.findOneAndUpdate({
								movie_id: req.params.movie_id,
								hash: req.params.hash
							}, {
								fullyUploaded: true
							}, (err, updatedMovie) => {
								if (err) {
									console.log(err);
									res.sendStatus(204);
								}
							});
							console.log('\nDownload of ' + downloadedFile.name + ' complete!\n');
						}
					}
				);
			});
		} catch (e) {
			if (e) {
				console.log(e);
				res.sendStatus(204);
			}
		}
	});

router.get('/subtitles/:encoded_path',
	middleware.isLoggedIn,
	async (req, res) => {
		try {
			const path = Buffer.from(req.params.encoded_path, 'base64').toString('ascii');
			const stat = await fs.statSync(path);
			const fileSize = stat.size;
			if (fileSize > 0) {
				const head = {
					'Content-Length': fileSize,
					'Content-Type': 'TextTrack',
				}
				res.writeHead(200, head);
				fs.createReadStream(path).pipe(res);
			} else {
				res.sendStatus(204);
			}
		} catch (e) {
			if (e) {
				console.log(e);
				res.sendStatus(204);
			}
		}
	});

router.get('/view1337x/:desc',
	middleware.isLoggedIn,
	middleware.torrentValidation,
	middleware.closeFFMPEG1337,
	async (req, res) => {
		try {
			var torrent = {};
			torrent.desc = Buffer.from(req.params.desc, 'base64').toString('ascii');
			torrent.provider = '1337x';
			torrent.description = await x(encodeURI(torrent.desc), 'div.torrent-detail.clearfix > div.torrent-detail-info > div > p')();
			torrent.magnet = await x(encodeURI(torrent.desc), 'a[href*="magnet:?xt=urn:btih:"]@href')();
			const torrentHtmlDetail = await TorrentSearchApi.getTorrentDetails(torrent);
			torrent.title = await x(torrentHtmlDetail, 'h1')();
			torrent.seeds = await x(torrentHtmlDetail, 'span.seeds')();
			torrent.peers = await x(torrentHtmlDetail, 'span.leeches')();
			torrent.encodedDescription = req.params.desc;
			torrent.encodedMagnet = await Buffer.from(torrent.magnet).toString('base64');
			torrent.encodedTitle = await Buffer.from(torrent.title).toString('base64');
			const torInfo = await parseTorrent(torrent.magnet);
			const hash = torInfo.infoHash.toUpperCase();
			const comments = await Comments.find({
				movie_id: req.params.desc
			}).populate('author').exec();
			var engine = torrentStream(torrent.magnet, {
				path: res.locals.downPath,
				tmp: 'tmp'
			});
			var filenames = []
			engine.on('torrent', async () => {
				engine.files = engine.files.sort(function (a, b) {
					return b.length - a.length
				}).slice(0, 1);
				for (let file of engine.files) {
					var ext = nodePath.parse(file.name).ext;
					if (ext == '.mkv' || ext == '.mp4' || ext == '.ogg') {
						filenames.push(file);
					}
				}
				if (filenames.length > 2) {
					console.log('Multiple files torrent request!')
					req.flash('error', "This torrent is not supported yet");
					res.redirect('/research');
				} else {
					torrent.size = pretty(filenames[0].length);
					res.render('video', {
						movie: torrent,
						comments: comments,
						yts: false,
						subs: res.locals.subs,
						hash: hash,
					});
				}
			})
		} catch (e) {
			if (e) {
				console.log(e);
				req.flash('error', "Torrent not found!");
				res.redirect('/research');
			}
		}
	});

router.get("/stream/:desc",
	middleware.isLoggedIn,
	middleware.checkIfDownloaded,
	async (req, res) => {
		try {
			var torrent = {};
			torrent.desc = Buffer.from(req.params.desc, 'base64').toString('ascii');
			torrent.provider = '1337x';
			torrent.magnet = await x(encodeURI(torrent.desc), 'a[href*="magnet:?xt=urn:btih:"]@href')();
			const torrentHtmlDetail = await TorrentSearchApi.getTorrentDetails(torrent);
			torrent.title = await x(torrentHtmlDetail, 'h1')();
			torrent.encodedMagnet = await Buffer.from(torrent.magnet).toString('base64');
			User.findById(req.user._id, (err, foundUser) => {
				if (err || !foundUser) {
					console.log(err)
				} else {
					if (!foundUser.seenMovies.includes(req.params.desc.toString())) {
						foundUser.seenMovies.push(req.params.desc.toString());
						foundUser.save((e) => {
							if (e) {
								console.log(e);
							}
						});
					}
				}
			});
			const magnet = torrent.magnet;
			const torInfo = await parseTorrent(magnet);
			const hash = torInfo.infoHash.toUpperCase();
			var engine = torrentStream(magnet, {
				path: res.locals.downPath,
				tmp: 'tmp'
			});
			var fileToStream = {};
			const range = req.headers.range;
			var parts = range.replace(/bytes=/, "").split("-");
			var start = parseInt(parts[0], 10);
			engine.on('ready', () => {
				engine.files = engine.files.sort((a, b) => {
					return b.length - a.length
				}).slice(0, 1);
				engine.files.forEach((file) => {
					var extension = u.getFileExtension(file.path);
					if (extension == 'mp4' || extension == 'ogg' || extension == 'mkv') {
						fileToStream = file;
						const path = res.locals.downPath + fileToStream.path;
						if ((extension == 'mp4' || extension == 'mkv' || extension == 'ogg') && !req.useragent.isFirefox) {
							var videoStream = file.createReadStream({
								start: start,
								end: file.length
							})
							u.stream_video(path, fileToStream, req, res, videoStream);
						} else if (extension == 'mkv' && req.useragent.isFirefox) {
							// CONVERTATION!!!!!!!!!!!!!!!!
							mainFileImport.eventSocket
								.to(req.user._id.toString())
								.emit('transcoding baby', {
									hash: hash
								});
							u.convertationAndStreaming(res, req, fileToStream, hash)
						}
						Movies.findOneAndUpdate({
							movie_id: req.params.desc,
							hash: torrent.encodedMagnet
						}, {
							lastSeen: Date.now()
						}, (err, foundMovie) => {
							if (!foundMovie) {
								Movies.create({
									movie_id: req.params.desc,
									path: path,
									filesize: fileToStream.length,
									hash: torrent.encodedMagnet,
									lastSeen: Date.now()
								})
							}
							if (err) {
								console.log(err);
							}
						});
					}
				});
			});
			engine.on('download', (pieceindex) => {
				process.stdout.write('#: ' + pieceindex + ' || Down: ' + (engine.swarm.downloaded / 1e+6).toFixed(2) + '/' + (fileToStream.length / 1e+6).toFixed(2));
				process.stdout.cursorTo(0);
			});
			engine.once('idle', async () => {
				var downloadedFile = {};
				engine.files = engine.files.sort(function (a, b) {
					return b.length - a.length
				}).slice(0, 1);
				engine.files.forEach((file) => {
					var extension = u.getFileExtension(file.path);
					if (extension == 'mp4' || extension == 'mkv' || extension == 'ogg') {
						downloadedFile = file;
					}
				});
				console.log(downloadedFile.path);
				cmd.get(
					'ffmpeg -v error -sseof -60 -i "' + res.locals.downPath + downloadedFile.path + '" -f null -',
					(err, data, stderr) => {
						if (stderr) {
							console.log('\nDownload is still in progress!')
						} else {
							Movies.findOneAndUpdate({
								movie_id: req.params.desc,
								hash: torrent.encodedMagnet
							}, {
								fullyUploaded: true
							}, (err, updatedMovie) => {
								if (err) {
									console.log(err);
								}
							});
							console.log('\nDownload of ' + downloadedFile.name + ' complete!\n');
						}
					}
				);
			});
		} catch (e) {
			if (e) {
				console.log(e);
			}
		}
	});

module.exports = router;
