const express = require("express");
const router = express.Router();
const passport = require("passport");
const User = require("../models/user");
const Token = require("../models/token");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const async = require("async");
const middleware = require("../middleware");
const loginRegExp = RegExp("^[a-zA-Z0-9_-]{3,20}$");
const nameRegExp = RegExp("^[a-zA-Z0-9 _-]{2,50}$");
const emailRegExp = RegExp("^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$");
const passwordRegExp = RegExp("(?!^[0-9]*$)(?!^[a-zA-Z]*$)^([a-zA-Z0-9]{6,15})$");
const inputRegExp = RegExp("^[A-Za-z0-9 -]{1,100}$");
const YtsApi = require('yts-api-pt');
const yts = new YtsApi();
const axios = require('axios');
const xss = require('xss');
const TorrentSearchApi = require('torrent-search-api');
const cheerio = require('cheerio');
const url = require('url');
const u = require('../middleware/utils');
TorrentSearchApi.enableProvider('1337x');
const activeProviders = TorrentSearchApi.getActiveProviders();
for (let provider of activeProviders) {
	console.log(provider.name);
}

router.get("/", middleware.isLoggedIn, async (req, res) => {
	const perPage = 6;
	yts.getMovies({
		limit: 30,
		page: 1,
		quality: 'All',
		minimumRating: 6,
		genre: 'action',
		sortBy: 'date_added',
		orderBy: 'desc',
		withRtRatings: true
	}).then((topYtsMovies) => {
		User.findById(req.user._id, (err, user) => {
			if (err || !user) {
				res.redirect('/login');
			} else {
				res.render("research", {
					search: false,
					foundMovies: topYtsMovies.data.movies,
					user: user.seenMovies,
					totalNumber: topYtsMovies.data.movies.length,
					perPage: perPage,
					query: ''
				});
			}
		});
	}).catch((e) => {
		if (e) {
			console.log(e);
			req.flash('error', 'Something went wrong on the provider side, please try again');
			res.redirect('/research');
		}
	});
});

router.put("/query/:page", middleware.isLoggedIn, middleware.checkSortInput, async (req, res) => {
	const sortType = xss(req.body.sortType);
	const sortOrder = xss(req.body.sortOrder);
	const page = parseInt(req.params.page);
	const perPage = 6;
	const year = {
		min: parseInt(xss(req.body.year.min)),
		max: parseInt(xss(req.body.year.max))
	};
	const rating = {
		min: parseInt(xss(req.body.rating.min)),
		max: parseInt(xss(req.body.rating.max))
	}
	if (!Number.isInteger(page) || page < 1) {
		return res.send({
			status: 'error',
			message: "Incorrect query"
		});
	} else {
		var querydata = xss(req.body.query);
		var queriedMovies = await TorrentSearchApi.search(querydata, 'Movies', 10);
		yts.getMovies({
			limit: 50,
			page: 1,
			quality: 'All',
			minimumRating: 0,
			queryTerm: querydata,
			sortBy: 'title',
			orderBy: 'asc',
			withRtRatings: true
		}).then(async (queriedYTSMovies) => {
			if (queriedMovies.length === 0 && queriedYTSMovies.data.movie_count === 0) {
				res.send({
					status: 'error',
					message: "Your search request '" + querydata + "' didn't return any results"
				});
			} else {
				var foundMovies = [];
				var finalMovieArray = [];
				if (queriedYTSMovies.data.movies && queriedYTSMovies.data.movies.length > 0) {
					for (let ytsmovie of queriedYTSMovies.data.movies) {
						ytsmovie.provider = 'yts';
						foundMovies.push(ytsmovie);
					}
				}
				foundMovies = await u.sortnfilterYTS(foundMovies, sortType, sortOrder, year, rating);
				queriedMovies = await u.sort1337(queriedMovies, sortType, sortOrder);
				if (queriedMovies && queriedMovies.length > 0) {
					for (let movie of queriedMovies) {
						u.shifrator2000(movie, foundMovies);
					}
				}
				var maxResults = (page * perPage) > foundMovies.length ? foundMovies.length : (page * perPage);
				for (var i = ((page * perPage) - perPage); i < maxResults; i++) {
					finalMovieArray.push(foundMovies[i]);
				}
				if (page > Math.ceil(foundMovies.length / perPage)) {
					return res.send({
						status: 'error',
						message: "Incorrect query"
					});
				} else {
					User.findById(req.user._id, (err, user) => {
						res.send({
							status: 'success',
							foundMovies: finalMovieArray,
							query: querydata,
							user: user.seenMovies,
							perPage: perPage,
							page: page,
							totalNumber: foundMovies.length
						});
					});
				}
			}
		}).catch((e) => {
			console.log(e);
			if (e) {
				res.send({
					status: 'error',
					message: "Invalid input. Please make sure you've entered valid data!"
				});
			}
		});
	}
});

module.exports = router;
