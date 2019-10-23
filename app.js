const dotenv = require("dotenv").config();
const express = require('express'),
	app = express(),
	bodyParser = require("body-parser"),
	mongoose = require("mongoose"),
	User = require("./models/user"),
	Movies = require("./models/movies"),
	passport = require("passport"),
	localStrategy = require("passport-local"),
	passportLocalMongoose = require("passport-local-mongoose"),
	methodOverride = require("method-override"),
	flash = require("connect-flash"),
	moment = require("moment"),
	expressSanitizer = require('express-sanitizer'),
	nodemailer = require("nodemailer"),
	crypto = require("crypto"),
	async = require("async"),
		iplocate = require('node-iplocate'),
		http = require('http'),
		socketio = require('socket.io'),
		passportSocketIo = require('passport.socketio'),
		cookieParser = require('cookie-parser'),
		session = require('express-session'),
		redis = require('redis'),
		redisStore = require('connect-redis')(session),
		server = http.Server(app),
		io = socketio(server),
		redisClient = redis.createClient(),
		xss = require("xss"),
		FortyTwoStrategy = require('passport-42').Strategy,
		GitHubStrategy = require('passport-github').Strategy,
		schedule = require('node-schedule'),
		rimraf = require("rimraf"),
		useragent = require('express-useragent');

const sessionStore = new redisStore({
	host: 'localhost',
	port: process.env.REDIS_PORT,
	client: redisClient,
	ttl: process.env.REDIS_TTL
});

redisClient.on('error', (err) => {
	console.log('Redis error: ', err);
});

process.env.runningConverts = [];
// requiring routes from ./routes folder
const authRoutes = require("./routes/index"),
	profileRoutes = require("./routes/profile"),
	researchRoutes = require("./routes/research"),
	videoRoutes = require("./routes/video"),
	commentsRoutes = require("./routes/comments");

// databse connection
mongoose.connect("mongodb://localhost/hypertube", {
	useNewUrlParser: true,
	useFindAndModify: false,
	useCreateIndex: true,
	autoIndex: true
}).catch(error => {
	console.log(error);
	console.log("Seems like there's a problem with the database - please check your connection and db's status");
});

mongoose.connection.on('error', err => {
	console.log(err);
	console.log("Seems like there's a problem with the database - please check your connection and db's status");
});

mongoose.set('debug', true);

app.set("view engine", "ejs"); //no need to write .ejs in the end of the file name
app.use(bodyParser.urlencoded({
	extended: true
}));

app.use(session({ //session initializer
	store: sessionStore,
	cookie: {
		secure: false
	},
	secret: process.env.SESSION_SECRET,
	resave: false,
	saveUninitialized: true
}));

io.use(passportSocketIo.authorize({
	key: 'connect.sid',
	secret: process.env.SESSION_SECRET,
	store: sessionStore,
	passport: passport,
	cookieParser: cookieParser
}));

app.use(expressSanitizer());

app.use(flash());
app.use(useragent.express());
app.use(express.static("public")); // including .css files directory here
app.use(passport.initialize());
app.use(passport.session());
app.use(methodOverride("_method"));

passport.use(new localStrategy(User.authenticate()));
passport.use(new FortyTwoStrategy({
		clientID: process.env.ECOLE_42_CLIENT_ID,
		clientSecret: process.env.ECOLE_42_CLIENT_SECRET,
		callbackURL: "http://" + process.env.PORTIK + "/auth/42/callback"
	},
	function (accessToken, refreshToken, profile, cb) {
		User.find({
			intra_id: profile._json.id
		}, (err, userok) => {
			if (userok.length > 0) {
				return cb(err, userok[0]);
			} else {
				User.find({
					username: profile._json.login
				}, (err, foundUser) => {
					if (err || foundUser.length == 0) {
						User.find({
							email: profile._json.email
						}, (err, foundemailuser) => {
							if (err || foundemailuser.length == 0) {
								User.find({
									intra_id: profile._json.id
								}, (err, user) => {
									if (err) {
										console.log(err);
										return cb(err);
									}
									//user is not found
									if (user.length == 0) {
										user = new User({
											intra_id: profile._json.id,
											isVerified: true,
											username: profile._json.login,
											email: profile._json.email,
											lastname: profile._json.last_name,
											firstname: profile._json.first_name,
											pictures: [{
												url: profile._json.image_url,
												isProfile: true
											}]
										});
										user.save((err, res) => {
											if (err) {
												console.log(err);
												return cb(err);
											} else {
												return cb(null, res);
											}
										});
									} else {
										//user is found!!!
										return cb(null, user[0]);
									}
								});
							} else {
								console.log("User with this email already exists")
								return cb(err, false, {
									message: "User with this email already exists"
								});
							}
						});
					} else {
						console.log("User with this username already exists");
						return cb(err, false, {
							message: "User with this username already exists"
						});
					}
				});
			}
		});
	}
));

passport.use(new GitHubStrategy({
		clientID: process.env.GIT_CLIENT_ID,
		clientSecret: process.env.GIT_CLIENT_SECRET,
		callbackURL: "http://" + process.env.PORTIK + "/auth/github/callback"
	},
	function (accessToken, refreshToken, profile, cb) {
		User.find({
			github_id: profile._json.id
		}, (err, userok) => {
			if (userok.length > 0) {
				return cb(err, userok[0]);
			} else {
				User.find({
					username: profile._json.login
				}, (err, foundUser) => {
					if (err || foundUser.length == 0) {
						if (profile._json.email !== "") {
							User.find({
								email: profile._json.email
							}, (err, foundemailuser) => {
								if (err || foundemailuser.length == 0) {
									User.find({
										github_id: profile._json.id,
									}, (err, user) => {
										if (err) {
											console.log(err);
											return cb(err);
										} else {
											//user is not found
											if (user.length == 0) {
												user = new User({
													github_id: profile.id,
													isVerified: true,
													username: profile._json.login,
													lastname: profile._json.name,
													firstname: profile._json.name,
													pictures: [{
														url: profile._json.avatar_url ? profile._json.avatar_url : "https://image.flaticon.com/icons/svg/25/25231.svg",
														isProfile: true
													}]
												});
												user.save((err, res) => {
													if (err) {
														console.log(err);
														return cb(err);
													} else {
														return cb(err, res);
													}
												});
											} else {
												//user is found!!!
												return cb(err, user[0]);
											}
										}
									});
								} else {
									console.log("User with this email already exists")
									return cb(err, false, {
										message: "User with this email already exists"
									});
								}
							});
						}
					} else {
						console.log("User with this username already exists");
						return cb(err, false, {
							message: "User with this username already exists"
						});
					}
				});
			}
		});
	}
));

passport.serializeUser((user, done) => {
	done(null, user);
});
passport.deserializeUser((user, done) => {
	done(null, user);
});

const home = 'Downloads/';
const school = '/Users/svovchyn/goinfre/Downloads/';

// allows using current user data across all the views
app.use((req, res, next) => {
	res.locals.downPath = school;
	res.locals.portik = process.env.PORTIK;
	res.locals.oauth = false;
	res.locals.message = "";
	res.locals.currentUser = req.user;
	res.locals.error = req.flash("error");
	res.locals.success = req.flash("success");
	next();
});

app.locals.moment = require('moment');

//including routes from the ./routes folder
app.use(authRoutes);
app.use("/profile", profileRoutes);
app.use("/research", researchRoutes);
app.use('/video', videoRoutes);
app.use('/comment', commentsRoutes);

app.get('*', (req, res) => {
	res.render('error');
});

var eventSocket = io.of('/events');
var onlineUsers = [];
module.exports.eventSocket = eventSocket;
// on connection event
eventSocket.on('connection', (socket) => {
	if (socket.request.user && socket.request.user.logged_in) {
		onlineUsers.push(socket.request.user);
		console.log(socket.request.user.username + " connected");
	}
	eventSocket.emit('broadcast', {
		onlineUsers: onlineUsers
	});
	socket.on('connectToRoom', socketId => {
		console.log(socket.request.user.username + " connected to the socket: " + socketId);
		var mySocketId = xss(socketId);
		socket.join(mySocketId);
	});
	socket.on('disconnect', () => {
		var leftUser = {};
		for (var i = 0; i < onlineUsers.length; i++) {
			if (onlineUsers[i]._id.toString() === socket.request.user._id.toString()) {
				User.findByIdAndUpdate(socket.request.user._id, {
					lastseen: Date.now()
				}, (err, user) => {
					if (err) {
						console.log(err);
					} else {
						console.log(socket.request.user.username + " disconnected");
						leftUser = user;
					}
				});
				onlineUsers.splice(i, 1);
			}
		}
		eventSocket.emit('broadcast', {
			onlineUsers: onlineUsers,
			leftUser: leftUser
		});
	});
});

var job = schedule.scheduleJob('42 23 * * *', () => {
	Movies.find({
		fullyUploaded: true
	}, (err, foundMovies) => {
		for (let movie of foundMovies) {
			var now = moment(Date.now());
			var lastSeen = moment(movie.lastSeen);
			var difference = now.diff(lastSeen, 'months');
			if (difference > 0) {
				rimraf(movie.path, {}, (err) => {
					console.log(movie.path + ' has been deleted!');
				});
				Movies.findByIdAndDelete(movie._id, (err) => {
					console.log(err);
				})
			}
		}
	});
});

let port = process.env.PORT;
if (port == null || port == "") {
	port = 3000;
}

server.listen(port, process.env.IP, () => {
	console.log("Setup is done, Sir!");
});
