
var P = require('../p');

exports.pending = function() {
	var def = P.defer();
	def.fulfill = def.resolve;
	return def;
};

exports.fulfilled = P.resolve;

exports.rejected = P.reject;
