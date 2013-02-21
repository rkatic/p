;(function( factory ){
	if ( typeof module !== "undefined" && module && module.exports ) {
		module.exports = factory();

	} else if ( typeof define !== "function" ) {
		define( factory );

	} else {
		P = factory();
	}
})(function() {
	"use strict";

	var
		// linked list with head node - used as a queue of tasks
		// f: task, w: ticks required, n: next node
		head = { f: null, w: 0, n: null }, tail = head,

		// vars for tick re-usage
		lastIsSafe = false, pendingTicks = 0, neededTicks = 0,

		channel, // MessageChannel
		requestTick, // requestTick( onTick, 0 ) is the only valid usage!

		// window or worker
		wow = ot(typeof window) && window || ot(typeof worker) && worker;

	function onTick() {
		--pendingTicks;
		while ( head.n ) {
			head = head.n;
			neededTicks -= head.w;
			var f = head.f;
			head.f = null;
			f();
		}
		lastIsSafe = false;
	}

	function runLater( f, couldThrow ) {
		var w = 0;
		if ( !lastIsSafe && ++neededTicks > pendingTicks ) {
			++pendingTicks;
			requestTick( onTick, 0 );
			w = 1;
		};
		tail = tail.n = { f: f, w: w, n: null };
		lastIsSafe = couldThrow !== true;
	}

	function ot( type ) {
		return type === "object" || type === "function";
	}

	function ft( type ) {
		return type === "function";
	}


	if ( ot(typeof process) && process && ft(typeof process.nextTick) ) {
		requestTick = process.nextTick;

	} else if ( wow && ft(typeof wow.setImmediate) ) {
		requestTick = function( cb ) {
			wow.setImmediate( cb );
		};

	} else if ( ft(typeof MessageChannel) ) {
		channel = new MessageChannel();
		channel.port1.onmessage = onTick;
		requestTick = function() {
			channel.port2.postMessage(0);
		};

	} else {
		requestTick = setTimeout;

		if ( wow && ot(typeof Image) && Image ) {
			(function(){
				var c = 0;

				var requestTickViaImage = function( cb ) {
					var img = new Image();
					img.onerror = cb;
					img.src = 'data:image/png,';
				};

				try {
					requestTickViaImage(function() {
						if ( --c === 0 ) {
							requestTick = requestTickViaImage;
						}
					});
					++c;
				} catch (e) {}

				c && setTimeout(function() {
					c = 0;
				}, 0);
			})();
		}
	}

	//__________________________________________________________________________

	function each( arr, cb ) {
		for ( var i = 0, l = arr.length; i < l; ++i ) {
			cb( arr[i], i );
		}
	}

	var P = resolve;
	P.prototype = Promise.prototype;

	P.defer = defer;
	function defer() {
		var pending = [],
			rejected = false,
			value;

		function then( onFulfilled, onRejected ) {
			var def = defer();

			function onReslved() {
				var func = rejected ? onRejected : onFulfilled;

				if ( typeof func !== "function" ) {
					if ( rejected ) {
						def.reject( value );
					} else {
						def.fulfill( value );
					}

				} else {
					var val;

					try {
						val = func( value );
						if ( val && typeof val.then === "function" ) {
							val.then( def.fulfill, def.reject );
							return;
						}
					} catch ( ex ) {
						def.reject( ex );
					}

					def.fulfill( val );
				}
			}

			if ( pending ) {
				pending.push( onReslved );

			} else {
				runLater( onReslved );
			}

			return def.promise;
		}

		function fulfill( val ) {
			if ( pending ) {
				value = val;
				each( pending, runLater );
				pending = null;
			}
		}

		function reject( error ) {
			if ( pending ) {
				rejected = true;
				fulfill( error );
			}
		}

		return {
			promise: new Promise( then ),
			fulfill: fulfill,
			reject: reject
		};
	}


	function Promise( then ) {
		this.then = then;
	}

	Promise.prototype.done = function( cb, eb ) {
		var p = this;
		if ( cb || eb ) {
			p = p.then( cb, eb );
		}
		p.then(null, function( error ) {
			runLater(function() {
				if ( P.onerror ) {
					P.onerror( error );
				} else {
					throw error;
				}
			}, true);
		});
	};

	Promise.prototype.spread = function( cb, eb ) {
		return this.then(cb && function( values ) {
			return cb.apply( void 0, values );
		}, eb);
	};

	P.resolve = resolve;
	function resolve( val ) {
		if ( val instanceof Promise ) {
			return val;
		}

		var def = defer();

		if ( val && typeof val.then === "function" ) {
			val.then( def.fulfill, def.reject );

		} else {
			def.fulfill( val );
		}

		return def.promise;
	}

	P.reject = reject;
	function reject( value ) {
		var def = defer();
		def.reject( value );
		return def.promise;
	}

	P.all = all;
	function all( promises ) {
		var countDown = promises.length;
		if ( countDown === 0 ) {
			return resolve( promises );
		}
		var def = defer();
		each(promises, function( promise, index ) {
			resolve( promise ).then(function( value ) {
				promises[ index ] = value;
				if ( --countDown === 0 ) {
					def.fulfill( promises );
				}
			}, def.reject );
		});
		return def.promise;
	}

	P.promise = function( makeOrPromise ) {
		var def = defer();
		resolve( makeOrPromise ).then(function( make ) {
			try {
				make( def.fulfill, def.reject );
			} catch ( ex ) {
				def.reject( ex );
			}
		}, def.reject);
		return def.promise;
	};

	P.onerror = null;

	P.nextTick = function( f ) {
		runLater( f, true );
	};

	//P.runLater = runLater;

	return P;
});
