var drachtio = require('../../..');
var app = drachtio() ;
var agent = new drachtio.Agent( app ) ;
var fs = require('fs') ;
var argv = require('minimist')(process.argv.slice(2));
var debug = require('debug')('basic') ;

module.exports = function( config ) {

	agent.set('api logger',fs.createWriteStream(config.apiLog) ) ;
	agent.connect(config.connect_opts) ;
	agent.route('invite') ;

	app.invite( function( req, res, next){
		res.send(486); 
	}) ;

	return agent ;
} ;
