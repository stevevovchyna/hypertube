const Xray = require('x-ray-scraper/Xray');
const async = require('async');
const https = require('https');
const fs = require('fs');
const x = Xray();
const OS = require('opensubtitles-api');
const ffmpeg = require('fluent-ffmpeg');
const OpenSubtitles = new OS({
	useragent: 'TemporaryUserAgent',
	username: process.env.SUBS_USERNAME,
	password: process.env.SUBS_PASSWORD,
	ssl: true
});
const parseTorrent = require('parse-torrent');
const pump = require('pump');
const stream = require('stream');
const nodePath = require('path');

var u = {};

u.convert = (file, res, req, id) => {
	console.log('Start converting file...')
	return new ffmpeg(file.createReadStream(), {
			source: req.user._id
		})
		.format('mp4')
		.outputOptions([
			'-ac', '2',
			'-c:a', 'aac',
			'-b:a', '128k',
			'-c:v', 'libx264',
			'-preset superfast',
			'-tune zerolatency',
			'-error-resilient 1',
			'-movflags frag_keyframe+empty_moov',
			// '-t 30',
			'-profile:v', 'baseline',
			'-level', '3.0',
			"-metadata", "videoid=" + id + req.user._id,
		])
		.on('end', () => {
			console.log('File is now mp4!');
		})
		.on('error', (err) => {
			console.log(err)
		})
		.on('progress', (progress) => {
			process.stdout.write("Current converting progress is: " + progress.frames + " frames | " + progress.timemark + " timemark |");
			process.stdout.cursorTo(0);
		})
}

u.convertationAndStreaming = (res, req, fileToStream, id) => {
	let responseStream = new stream.Writable();
	let responseClosed = false;
	res.on('close', function () {
		console.log('Response closed!');
		responseClosed = true;
	});
	responseStream._write = (chunk, encoding, done) => {
		let checker = setInterval(() => {
			if (responseClosed)
				cb();
		}, 50);
		let cb = () => {
			clearInterval(checker);
			done();
		}
		if (responseClosed)
			return cb();
		res.write(chunk, encoding, cb);
	}
	responseStream.on('end', () => {
		console.log('\nResponse stream has reached it`s end');
		res.end();
	});
	console.log('\nPumping to res and file...');
	pump(u.convert(fileToStream, res, req, id), responseStream);
}

u.sortnfilterYTS = async (movies, sortType, sortOrder, year, rating) => {
	if (sortOrder == 'asc') {
		switch (sortType) {
			case 'title':
				var moviesArray = movies.sort((a, b) => a.title > b.title ? 1 : -1);
				break;
			case 'year':
				var moviesArray = movies.sort((a, b) => a.year > b.year ? 1 : -1);
				break;
			case 'rating':
				var moviesArray = movies.sort((a, b) => a.rating > b.rating ? 1 : -1);
				break;
			case 'seeds':
				for (let movie of movies) {
					movie.torrents = movie.torrents.sort((a, b) => a.seeds < b.seeds ? 1 : -1);
				}
				var moviesArray = movies.sort((a, b) => a.torrents[0].seeds > b.torrents[0].seeds ? 1 : -1);
				break;
			case 'peers':
				for (let movie of movies) {
					movie.torrents = movie.torrents.sort((a, b) => a.peers < b.peers ? 1 : -1);
				}
				var moviesArray = movies.sort((a, b) => a.torrents[0].peers > b.torrents[0].peers ? 1 : -1);
				break;
			default:
				var moviesArray = movies;
				console.log('niudacha')
		}
	} else if (sortOrder == 'desc') {
		switch (sortType) {
			case 'title':
				var moviesArray = movies.sort((a, b) => a.title < b.title ? 1 : -1);
				break;
			case 'year':
				var moviesArray = movies.sort((a, b) => a.year < b.year ? 1 : -1);
				break;
			case 'rating':
				var moviesArray = movies.sort((a, b) => a.rating < b.rating ? 1 : -1);
				break;
			case 'seeds':
				for (let movie of movies) {
					movie.torrents = movie.torrents.sort((a, b) => a.seeds < b.seeds ? 1 : -1);
				}
				var moviesArray = movies.sort((a, b) => a.torrents[0].seeds < b.torrents[0].seeds ? 1 : -1);
				break;
			case 'peers':
				for (let movie of movies) {
					movie.torrents = movie.torrents.sort((a, b) => a.peers < b.peers ? 1 : -1);
				}
				var moviesArray = movies.sort((a, b) => a.torrents[0].peers < b.torrents[0].peers ? 1 : -1);
				break;
			default:
				var moviesArray = movies;
				console.log('niudacha');
		}
	}
	moviesArray = moviesArray.filter(movies => movies.year >= year.min && movies.year <= year.max);
	moviesArray = moviesArray.filter(movies => movies.rating >= rating.min && movies.rating <= rating.max);
	return moviesArray;
}

u.sort1337 = (movies, sortType, sortOrder) => {
	var arrayOfMovies = [];
	if (sortType == 'title') {
		if (sortOrder == 'asc') {
			arrayOfMovies = movies.sort((a, b) => a.title > b.title ? 1 : -1);
		} else if (sortOrder == 'desc') {
			arrayOfMovies = movies.sort((a, b) => a.title < b.title ? 1 : -1);
		}
	} else if (sortType == 'peers' || sortType == 'seeds') {
		if (sortOrder == 'asc') {
			switch (sortType) {
				case 'peers':
					arrayOfMovies = movies.sort((a, b) => a.peers > b.peers ? 1 : -1);
					break;
				case 'seeds':
					arrayOfMovies = movies.sort((a, b) => a.seeds > b.seeds ? 1 : -1);
					break;
			}
		} else if (sortOrder == 'desc') {
			switch (sortType) {
				case 'peers':
					arrayOfMovies = movies.sort((a, b) => a.peers < b.peers ? 1 : -1);
					break;
				case 'seeds':
					arrayOfMovies = movies.sort((a, b) => a.seeds < b.seeds ? 1 : -1);
					break;
			}
		}
	} else {
		arrayOfMovies = movies;
	}
	return arrayOfMovies;
}

u.getFileExtension = (filename) => {
	return filename.slice((filename.lastIndexOf(".") - 1 >>> 0) + 2);
}

u.getFilePath = async (torrent) => {
	const files = await torrent.files;
	var path = {};
	path.name = torrent.name;
	path.filename = "";
	for (let file of files) {
		var extension = await u.getFileExtension(file.path);
		if (extension == 'mp4' || extension == 'mkv' || extension == 'ogg') {
			path.name = file.name;
			path.filename = file.path;
			path.TmpDir = 'tmp/' + file.path;
		}
	}
	return path;
}

u.downloadTorrents = async (torrents) => {
	torrents.forEach(async (torrent) => {
		try {
			const path = 'TorrentFiles/' + torrent.hash + ".torrent";
			if (!fs.existsSync(path)) {
				const file = await fs.createWriteStream(path);
				const request = await https.get(torrent.url, (response) => {
					response.pipe(file);
				});
			}
		} catch (e) {
			if (e) {
				console.log(e);
			}
		}
	});
	return new Promise(resolve => {
		resolve();
	});
}

u.isEmpty = (obj) => {
	for (var key in obj) {
		if (obj.hasOwnProperty(key))
			return false;
	}
	return true;
}

u.saveSubtitles = async (subtitles, path) => {
	var subs = [];
	if (subtitles.en) {
		var subPathEn = 'Subtitles/' + path.name + '-en.vtt';
		subs.push({
			path: Buffer.from(subPathEn).toString('base64'),
			language: 'en',
			label: 'English'
		});
		if (!fs.existsSync(subPathEn)) {
			const file = await fs.createWriteStream(subPathEn);
			const request = await https.get(subtitles.en.vtt, async (response) => {
				await response.pipe(file);
			});
		}
	}
	if (subtitles.fr) {
		const subPathFr = 'Subtitles/' + path.name + '-fr.vtt';
		subs.push({
			path: Buffer.from(subPathFr).toString('base64'),
			language: 'fr',
			label: 'French'
		});
		if (!fs.existsSync(subPathFr)) {
			const file = await fs.createWriteStream(subPathFr);
			const request = await https.get(subtitles.fr.vtt, async (response) => {
				await response.pipe(file);
			});
		}
	}
	if (subtitles.es) {
		const subPathEs = 'Subtitles/' + path.name + '-es.vtt';
		subs.push({
			path: Buffer.from(subPathEs).toString('base64'),
			language: 'es',
			label: 'Spanish'
		});
		if (!fs.existsSync(subPathEs)) {
			const file = await fs.createWriteStream(subPathEs);
			const request = await https.get(subtitles.es.vtt, async (response) => {
				await response.pipe(file);
			});
		}
	}
	if (subtitles.ru) {
		const subPathRu = 'Subtitles/' + path.name + '-ru.vtt';
		subs.push({
			path: Buffer.from(subPathRu).toString('base64'),
			language: 'ru',
			label: 'Russian'
		});
		if (!fs.existsSync(subPathRu)) {
			const file = await fs.createWriteStream(subPathRu);
			const request = await https.get(subtitles.ru.vtt, async (response) => {
				await response.pipe(file);
			});
		}
	}
	return new Promise(resolve => {
		resolve(subs);
	});
}

u.downloadSubtitles = async (foundFilm) => {
	for (let torrent of foundFilm.data.movie.torrents) {
		const path = 'TorrentFiles/' + torrent.hash + '.torrent';
		var tor = {};
		try {
			tor = await parseTorrent(fs.readFileSync(path));
		} catch (e) {
			if (e) {
				console.log(e);
				torrent.isSupported = false;
			}
		}
		if (tor.files) {
			for (let file of tor.files) {
				const extension = u.getFileExtension(file.name);
				if (extension == 'mp4' || extension == 'mkv' || extension == 'ogg') {
					await OpenSubtitles.search({
						query: file.name
					}).then(async (subtitles) => {
						await u.saveSubtitles(subtitles, file).then(async (subtitles) => {
							torrent.subs = subtitles;
						});
					}).catch(e => {
						console.log(e);
						return new Promise((resolve, reject) => {
							reject('Service is unavailable right now');
						})
					});
				}
			}
		}
	}
	return new Promise(resolve => {
		resolve(foundFilm);
	});
}

u.deshifrator5000 = async (torrent, params) => {
	torrent.decodedDesc = params.desc;
	torrent.decodedMagnet = params.magnet
	torrent.title = Buffer.from(params.title, 'base64').toString('ascii');
	torrent.seeds = Buffer.from(params.seeds, 'base64').toString('ascii');
	torrent.peers = Buffer.from(params.peers, 'base64').toString('ascii');
	torrent.size = Buffer.from(params.size, 'base64').toString('ascii');
	torrent.desc = Buffer.from(params.desc, 'base64').toString('ascii');
	torrent.description = await x(encodeURI(torrent.desc), 'div.torrent-detail.clearfix > div.torrent-detail-info > div > p')();
	torrent.magnet = await x(encodeURI(torrent.desc), 'a[href*="magnet:?xt=urn:btih:"]@href')();
	torrent.encodedMagnet = await Buffer.from(torrent.magnet).toString('base64');
	torrent.encodedTitle = await Buffer.from(torrent.title).toString('base64');
}

u.shifrator2000 = (movie, foundMovies, pushMode = true) => {
	movie.encodedMagnet = 'noMagnet';
	var title = Buffer.from(movie.title);
	var size = movie.size == null ? Buffer.from('n/a') : Buffer.from(movie.size);
	var seeds = movie.seeds == null ? Buffer.from('n/a') : Buffer.from(movie.seeds.toString());
	var peers = movie.peers == null ? Buffer.from('n/a') : Buffer.from(movie.peers.toString());
	var desc = Buffer.from(movie.desc);
	movie.encodedTitle = title.toString('base64');
	movie.encodedSize = size.toString('base64');
	movie.encodedSeeds = seeds.toString('base64');
	movie.encodedPeers = peers.toString('base64');
	movie.encodedDesc = desc.toString('base64');
	movie.provider = '1337x';
	if (pushMode) {
		foundMovies.push(movie);
	}
}

u.stream_video = async (path, fileToStream, req, res, stream) => {
	try {
		const stat = await fs.statSync(path);
		console.log("\n" + fileToStream.name + ' is being loaded to the player');
		const fileSize = fileToStream.length;
		var range = req.headers.range;
		const ext = 'mp4';
		if (range) {
			var parts = range.replace(/bytes=/, "").split("-");
			var start = parseInt(parts[0], 10);
			var end = parts[1] ?
				parseInt(parts[1], 10) :
				fileSize - 1;
			var chunksize = (end - start) + 1;
			var head = {
				'Content-Range': `bytes ${start}-${end}/${fileSize}`,
				'Accept-Ranges': 'bytes',
				'Content-Length': chunksize,
				'Content-Type': 'video/' + ext,
			}
			res.writeHead(206, head);
			stream.pipe(res);
		} else {
			var head = {
				'Content-Length': fileSize,
				'Content-Type': 'video/' + ext,
			}
			res.writeHead(200, head);
			fs.createReadStream(path).pipe(res);
		}
	} catch (e) {
		if (e) {
			setTimeout(() => {
				u.stream_video(path, fileToStream, req, res, stream);
			}, 7000);
		}
	}
}

module.exports = u;
