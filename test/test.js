(function(){
"use strict";

var opt_tracing = typeof TRACE_FUNCTIONS !== "undefined";

if ( typeof P === "undefined" ) {
	global.P = require(opt_tracing ? "./p" : "../p");
	global.expect = require("expect.js");
	//require("mocha");
}

if ( opt_tracing ) {
	TRACE_FUNCTIONS.stopAdding();

	beforeEach(function() {
		TRACE_FUNCTIONS.optimize();
	});

	afterEach(function() {
		TRACE_FUNCTIONS.optimize();
	});
}

var isNodeJS = typeof process === "object" && process &&
	({}).toString.call(process) === "[object process]";


function fail() {
	expect(true).to.be(false);
}

function thenableSyncFulfillment( value ) {
	return {
		then: function( cb, eb ) {
			cb( value );
		}
	};
}

function thenableSyncRejection( reason ) {
	return {
		then: function( cb, eb ) {
			eb( reason );
		}
	};
}

function thenableFulfillment( value ) {
	return {
		then: function( cb, eb ) {
			setTimeout(function() {
				cb( value );
			}, 0)
		}
	};
}

function thenableRejection( reason ) {
	return {
		then: function( cb, eb ) {
			setTimeout(function() {
				eb( reason );
			}, 0)
		}
	};
}

var VALUES = ["", true, false, 0, 1, 2, -1, -2, {}, [], {x: 1}, [1,2,3], null, void 0, new Error()];

var FULLFILMENTS = VALUES.concat(
	VALUES.map( P ),
	VALUES.map( thenableFulfillment ),
	VALUES.map( thenableSyncFulfillment )
);

var REJECTIONS = [].concat(
	VALUES.map( P.reject ),
	VALUES.map( thenableRejection ),
	VALUES.map( thenableSyncRejection )
);

var FULLFILMENTS_AND_REJECTIONS = FULLFILMENTS.concat( REJECTIONS );

function map( array, f ) {
	var array2 = new Array(array.length|0);
	for ( var i = 0, l = array.length; i < l; ++i ) {
		if ( i in array ) {
			array2[i] = f( array[i], i, array );
		}
	}
	return array2;
}

function allValues( func ) {
	return P.all( map(VALUES, func) );
}

describe("P function", function() {

	it("should return a promise", function() {
		var Promise = P().constructor;

		expect(
			Promise.constructor.name === "Promise" ||
			Promise.toString().lastIndexOf("function Promise", 0) === 0
		).to.be(true);

		map(FULLFILMENTS_AND_REJECTIONS, function( value ) {
			expect( P(value) instanceof Promise ).to.be(true);
		});
	});

	it("should return input itself if it is a promise", function() {
		var p = P();
		expect( P(p) ).to.be( p );
	});

	it("should fulfill with input if not a promise", function() {
		return allValues(function( value ) {
			return P( value ).then(function( fulfilledValue ) {
				expect( fulfilledValue ).to.be( value );
			});
		});
	});
});

describe("inspect", function() {

	it("on fulfillment", function() {
		return allValues(function( value ) {
			var p = P( value );
			return p.then(function() {
				expect( p.inspect() ).to.be.eql( {state: "fulfilled", value: value} );
			});
		});
	});

	it("on rejection", function() {
		return allValues(function( reason ) {
			var d = P.defer();
			var p = d.promise;
			expect( p.inspect() ).to.be.eql( {state: "pending"} );
			d.reject( reason );
			return p.then( fail, function() {
				expect( p.inspect() ).to.be.eql( {state: "rejected", reason: reason} );
			});
		});
	});
});

describe("reject", function() {

	it("returns a rejected promise", function() {
		return allValues(function( reason ) {
			return P.reject( reason ).then( fail, function( rejectedReason ) {
				expect( rejectedReason ).to.be( reason );
			});
		});
	});
});

function deep( func ) {
	var d = P.defer();
	var p = d.promise;
	var n = 10000;
	while ( n-- ) {
		p = func([ p ]);
	}
	d.promise = p;
	return d;
}

describe("all", function() {

	it("resolves when passed an empty array", function() {
		return P.all([]);
	});

	it("resolves when passed an array", function() {
		var toResolve = P.defer();
		var array = VALUES.concat( toResolve.promise );
		var array2 = array.slice();
		array2[ array2.length - 1 ] = 12;
		var promise = P.all( array );

		toResolve.resolve(12);

		return promise.then(function( values ) {
			expect( values ).to.be.eql( array2 );
		});
	});

	it("rejects if any consituent promise is rejectd", function() {
		var toReject = P.defer();
		var theReason = new Error();
		toReject.reject( theReason );
		var array = FULLFILMENTS.concat( toReject.promise )

		return P.all( array )
		.then( fail, function( reason ) {
			expect( reason ).to.be( theReason );
		})
		.then(function() {
			var toRejectLater = P.defer();
			var array = FULLFILMENTS.concat( toRejectLater.promise );
			var promise = P.all( array );
			toRejectLater.reject( theReason );
			return promise;
		})
		.then( fail, function( reason ) {
			expect( reason ).to.be( theReason );
		});
	});

	it("should resolve on deep resolved promise", function() {
		var d = deep( P.all );
		d.resolve( 1 );
		return d.promise;
	});

	it("should reject on deep rejected promise", function() {
		var d = deep( P.all );
		d.reject( 7 );
		return d.promise.then(fail, function( reason ) {
			expect( reason ).to.be( 7 );
		});
	});
});

describe("allSettled", function() {

	it("resolves when passed an empty array", function() {
		return P.allSettled([]);
	});

	it("resolves when passed an array", function() {
		var array = FULLFILMENTS_AND_REJECTIONS;
		var promise = P.allSettled( array );

		return promise.then(function( settled ) {
			for ( var i = 0; i < settled.length; ++i ) {
				var expectedValue = VALUES[ i % VALUES.length ];

				if ( i < FULLFILMENTS.length ) {
					expect( settled[i] ).to.be.eql( {state: "fulfilled", value: expectedValue} );

				} else {
					expect( settled[i] ).to.be.eql( {state: "rejected", reason: expectedValue} );
				}
			}
		});
	});

	it("should resolve on deep resolved promise", function() {
		var d = deep( P.allSettled );
		d.resolve( 1 );
		return d.promise;
	});

	it("should resolve on deep rejected promise", function() {
		var d = deep( P.allSettled );
		d.reject( new Error("foo") );
		return d.promise;
	});
});

describe("spread", function() {

	it("spreads values across arguments", function() {
		return P([1, P(2), 3]).spread(function( one, two, three ) {
			expect( one ).to.be( 1 );
			expect( two ).to.be( 2 );
			expect( three ).to.be( 3 );
		});
	});

	it("should call the errback in case of a rejected promise", function() {
		var toReject = P.defer();
		var theReason = new Error();
		toReject.reject( theReason );

		return P([ 1, P(2), toReject.promise]).spread(
			fail,
			function( reason ) {
				expect( reason ).to.be( theReason );
			}
		);
	});
});

describe("done", function() {

	afterEach(function() {
		P.onerror = null;
	});

	// TODO: cover other cases too!

	describe("when the promise is rejected", function() {
		describe("and there is no errback", function() {

			it("should throw the reason in a next turn", function( done ) {
				var turn = 0;
				var toReject = P.defer();
				toReject.reject("foo");
				var promise = toReject.promise;

				expect( promise.done() ).to.be( undefined );

				P.onerror = function( error ) {
					expect( turn ).to.be( 1 );
					expect( error ).to.be("foo");
					done();
				};

				++turn;
			});

		});
	});
});

describe("fin", function() {

	describe("when the promise is fulfilled", function() {

		it("should call the callback and fulfill with the original value", function() {
			var called = false;

			return P("foo")
			.fin(function() {
				called = true;
				return "boo";
			})
			.then(function( value ) {
				expect( called ).to.be( true );
				expect( value ).to.be("foo");
			});
		});

		describe("when the callback returns a promise", function() {

			describe("that is fulfilled", function() {
				it("should fulfill with the original value after the promise is settled", function() {
					var delayed = P("boo").delay(50);

					return P("foo")
					.fin(function() {
						return delayed;
					})
					.then(function( value ) {
						expect( delayed.inspect() ).to.be.eql({ state: "fulfilled", value: "boo" });
						expect( value ).to.be("foo");
					});
				})
			});

			describe("that is rejected", function() {
				it("should reject with this new reason", function() {
					var theError = new Error("boo");

					return P("foo")
					.fin(function() {
						return P.reject( theError );
					})
					.then(fail, function( reason ) {
						expect( reason ).to.be( theError );
					});
				});
			});

		});

		describe("when the callback throws an exception", function() {
			it("should reject with this new exception", function() {
				var theError = new Error("boo");

				return P("foo")
				.fin(function() {
					throw theError;
				})
				.then(fail, function( reason ) {
					expect( reason ).to.be( theError );
				});
			});
		});

	});

	describe("when the promise is rejected", function () {

		var theError = new Error("nooo");

		it("should call the callback and reject with the original reason", function() {
			var called = false;

			return P.reject( theError )
			.fin(function() {
				called = true;
				return "boo";
			})
			.then(fail, function( reason ) {
				expect( called ).to.be( true );
				expect( reason ).to.be( theError );
			});
		});

		describe("when the callback returns a promise", function() {

			describe("that is fulfilled", function() {
				it("should reject with the original reason after the promise is settled", function() {
					var delayed = P("boo").delay(50);

					return P.reject( theError )
					.fin(function() {
						return delayed;
					})
					.then(fail, function( reason ) {
						expect( delayed.inspect() ).to.be.eql({ state: "fulfilled", value: "boo" });
						expect( reason ).to.be( theError );
					});
				})
			});

			describe("that is rejected", function() {
				it("should reject with this new reason", function() {
					return P.reject( new Error("boo") )
					.fin(function() {
						return P.reject( theError );
					})
					.then(fail, function( reason ) {
						expect( reason ).to.be( theError );
					});
				});
			});

		});

		describe("when the callback throws an exception", function() {
			it("should reject with this new exception", function() {
				var theError = new Error("boo");

				return P.reject( new Error("boo") )
				.fin(function() {
					throw theError;
				})
				.then(fail, function( reason ) {
					expect( reason ).to.be( theError );
				});
			});
		});

	});

});

describe("timeout", function() {

	// This part is based on the respective part of the Q spec.

	it("should do nothing if the promise fulfills quickly", function() {
		return P().delay( 10 ).timeout( 100 );
	});

	it("should do nothing if the promise rejects quickly", function() {
		var error = new Error();

		return P().delay( 10 )
		.then(function() {
			throw error;
		})
		.timeout( 100 )
		.then( fail, function( reason ) {
			expect( reason ).to.be( error );
		});
	});

	it("should reject within a timeout error if the promise is too slow", function() {
		return P().delay( 100 )
		.timeout( 10 )
		.then( fail, function( reason ) {
			expect( reason.message ).to.match(/time/i);
		});
	});

	it("should reject with a custom timeout message if the promise is too slow", function() {
		return P().delay( 100 )
		.timeout(10, "custom")
		.then( fail, function( reason ) {
			expect( reason.message ).to.match(/custom/i);
		});
	});
});

describe("delay", function() {

	// This part is based on the respective part of the Q spec.

	it("should dealy fulfillment", function() {
		var promise = P(1).delay( 50 );

		setTimeout(function() {
			expect( promise.inspect().state ).to.be("pending");
		}, 30);

		return promise;
	});

	it("should not dealy rejection", function() {
		var d = P.defer();
		d.reject(1);
		var promise = d.promise.delay( 50 );

		setTimeout(function() {
			expect( promise.inspect().state ).to.be("rejected");
		}, 30);

		return promise.then( fail, function(){} );
	});

	it("should delay after fulfillment", function() {
		var p1 = P("foo").delay( 30 );
		var p2 = p1.delay( 30 );

		setTimeout(function() {
			expect( p1.inspect().state ).to.be("fulfilled");
			expect( p2.inspect().state ).to.be("pending");
		}, 45);

		return p2.then(function( value ) {
			expect( value ).to.be("foo");
		});
	});
});

describe("nodeify", function() {

	it("calls back with a resolution", function( done ) {
		P( 7 ).nodeify(function( error, value ) {
			expect( error ).to.be( null );
			expect( value ).to.be( 7 );
			done();
		});
	});

	it("calls back with an error", function( done ) {
		P.reject( 13 ).nodeify(function( error, value ) {
			expect( error ).to.be( 13 );
			expect( value ).to.be( void 0 );
			done();
		});
	});

	it("forwards a fullfilment", function() {
		return P( 5 ).nodeify( void 0 ).then(function( value ) {
			expect( value ).to.be( 5 );
		});
	});

	it("forwards a rejection", function() {
		return P.reject( 3 ).nodeify( void 0 ).then(fail, function( reason ) {
			expect( reason ).to.be( 3 );
		});
	});
});

describe("promised", function() {

	var sum = P.promised(function( a, b ) {
		return a + b;
	});

	var inc = P.promised(function( n ) {
		return this + n;
	});

	it("resolves promised arguments", function() {
		return sum( P(1), 2 ).then(function( res ) {
			expect( res ).to.be( 3 );
		});
	});

	it("resolves promised `this`", function() {
		return inc.call( P(4), 1 ).then(function( res ) {
			expect( res ).to.be( 5 );
		});
	});

	it("is rejected if an argument is rejected", function() {
		return sum( P.reject(1), 2 ).then(fail, function( e ) {
			expect( e ).to.be( 1 );
		});
	});

	it("is rejected if `this` is rejected", function() {
		return inc.call( P.reject(1), P(2) ).then(fail, function( e ) {
			expect( e ).to.be( 1 );
		});
	});

});

describe("denodeify", function() {

	it("should fulfill if no error", function() {
		var f = P.denodeify(function( a, b, c, d, callback ) {
			callback( null, a + b + c + d );
		});

		return f( 1, 2, 3, 4 ).then(function( value ) {
			expect( value ).to.be( 10 );
		});
	});

	it("should reject on error", function() {
		var theError = new Error();

		var f = P.denodeify(function( a, b, c, d, callback ) {
			callback( theError );
		});

		return f( 1, 2, 3, 4 ).then(fail, function( reason ) {
			expect( reason ).to.be( theError );
		});
	});

	it("should reject on thrown error", function() {
		var theError = new Error();

		var f = P.denodeify(function( a, b, c, d, callback ) {
			throw theError;
		});

		return f( 1, 2, 3, 4 ).then(fail, function( reason ) {
			expect( reason ).to.be( theError );
		});
	});

});

!opt_tracing && describe("longStackSupport", function() {

	Error.stackTraceLimit = Infinity;

	beforeEach(function() {
		P.longStackSupport = true;
	});

	afterEach(function() {
		P.longStackSupport = false;
	});

	function createError( msg ) {
		try {
			throw new Error( msg );

		} catch ( e ) {
			return e;
		}
	}

	function checkError( error, expectedNamesStr ) {
		expect( error instanceof Error ).to.be( true );

		var stacks = error.stack
			.split("_it_")[0]
			.split("\nFrom previous event:\n");

		var str = map(stacks, function( stack ) {
			return ( stack.match(/_(\w+)_/g) || [] )
				.join("")
				.split("__").join("-")
				.slice(1, -1);
		})
		.join(" ")
		.replace(/^\s+|\s+$/g, "")
		.replace(/\s+/g, " ");

		expect( str ).to.be( expectedNamesStr );
	}

	it("should make trace long on sync rejected thenable", function _it_() {
		return P().then(function _5_() {
			return P().then(function _4_() {
				return P().then(function _3_() {
					return {then: function _2_( cb, eb ) {
					  cb({then: function _1_( cb, eb ) {
						eb( createError() );
					  }});
					}};
				});
			})
		})
		.then(fail, function( error ) {
			checkError(error, "1-2 4 5");
		});
	});

	it("should make trace long on async rejected thenable", function _it_() {
		return P().then(function _5_() {
			return P().then(function _4_() {
				return P().then(function _3_() {
					return {then: function _2_( cb, eb ) {
						setTimeout(function _b_() {
							cb({then: function _1_( cb, eb ) {
								cb({then: function( cb, eb ) {
									setTimeout(function _a_() {
										eb( new Error() );
									}, 0);
								}});
							}});

							P().then(function _c_() {
								throw new Error();
							})
							.done(null, function( error ) {
								checkError(error, "c b");
							});
						}, 0);
					}};
				});
			})
		})
		.then(fail, function( error ) {
			checkError(error, "a 1-b 4 5");
		});
	});


	it("should make trace long if denodeifed function rejects", function _it_() {

		var rejection = P.denodeify(function( nodeback ) {
			setTimeout(function _0_() {
				nodeback( new Error() );
			}, 0);
		});

		return P().then(function _2_() {
			return P().then(function _1_() {
				return rejection();
			});
		})
		.then(fail, function( error ) {
			checkError(error, "0 1 2");
		});
	});

	it("should make trace long on timeouted promise", function _it_() {
		return P().then(function _2_() {
			return P().then(function _1_() {
				return P.defer().promise.timeout(1);
			});
		})
		.then(fail, function( error ) {
			checkError(error, "1 2");
		});
	});

});

if ( isNodeJS && !/v0\.8\./.test(process.version) ) describe("domain", function() {

	var domain = require("domain");

	it("should work with domains", function() {
		var d = P.defer();
		var theValue = 0;
		var theError = new Error();

		P(47).then(function( value ) { theValue = value; });

		var theDomain = domain.create();
		theDomain.on("error", function( error ) {
			expect( theValue ).to.be( 47 );
			expect( error ).to.be( theError );
			P().then( d.resolve );
		})
		.run(function() {
			P().then(function() {
				expect( domain.active ).to.be( theDomain );
			}).done();

			P.reject( theError ).done();
		});

		return d.promise.then(function() {
			expect( domain.active ).not.to.be( theDomain );
		}, fail);
	});

	it("should not evaluate promises in disposed domains", function() {
		var theDomain = domain.create();
		var called = false;

		theDomain.on("error", function( e ) {
			P().then(function() { called = true; });
			theDomain.dispose();
		})
		.run(function() {
			P.reject( new Error() ).done();
		});

		return P().delay(10).then(function() {
			expect( called ).to.be( false );
		});
	});
});

})();
