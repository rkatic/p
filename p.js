;(function( factory ){
	// CommonJS
	if ( typeof module !== "undefined" && module && module.exports ) {
		module.exports = factory();

	// RequireJS
	} else if ( typeof define === "function" && define.amd ) {
		define( factory );

	// global
	} else {
		P = factory();
	}
})(function() {
	"use strict";

	var
		// linked list with head node - used as a queue of tasks
		// f: task, w: needed a tick, n: next node
		head = { f: null, w: false, n: null }, tail = head,

		// vars for tick re-usage
		nextNeedsTick = true, pendingTicks = 0, neededTicks = 0,

		channel, // MessageChannel
		requestTick, // requestTick( onTick, 0 ) is the only valid usage!

		// window or worker
		wow = ot(typeof window) && window || ot(typeof worker) && worker,

		toStr = head.toString,
		isArray,

		ALT = {};

	function onTick() {
		--pendingTicks;
		if ( head.n ) {
			if ( !pendingTicks && head.n.n ) {
				// In case of multiple tasks, ensure at least one successive tick
				// to handle remaining task in case one throws, even if specified it will not.
				++pendingTicks;
				requestTick( onTick, 0 );
			}
			do {
				head = head.n;
				if ( head.w ) {
					--neededTicks;
				}
				var f = head.f;
				head.f = null;
				f();
			} while ( head.n )
		}
		nextNeedsTick = true;
	}

	function runLater( f, couldThrow ) {
		if ( nextNeedsTick && ++neededTicks > pendingTicks ) {
			++pendingTicks;
			requestTick( onTick, 0 );
		};
		tail = tail.n = { f: f, w: nextNeedsTick, n: null };
		nextNeedsTick = couldThrow === true;
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

				// Before using it, test if it works properly, with async dispatching.
				try {
					requestTickViaImage(function() {
						if ( --c === 0 ) {
							requestTick = requestTickViaImage;
						}
					});
					++c;
				} catch (e) {}

				// Also use it only if faster then setTimeout.
				c && setTimeout(function() {
					c = 0;
				}, 0);
			})();
		}
	}

	//__________________________________________________________________________

	isArray = Array.isArray || function( val ) {
		return !!val && toStr.call( val ) === "[object Array]";
	};

	function forEach( arr, cb ) {
		for ( var i = 0, l = arr.length; i < l; ++i ) {
			if ( i in arr ) {
				cb( arr[i], i );
			}
		}
	}

	function each( obj, cb ) {
		if ( isArray(obj) ) {
			forEach( obj, cb );
			return;
		}

		for ( var prop in obj ) {
			cb( obj[prop], prop );
		}
	}

	function P( val ) {
		if ( val instanceof Promise ) {
			return val;
		}

		var def = defer();
		def.resolve( val );
		return def.promise;
	}

	P.defer = defer;
	function defer() {
		var pending = [],
			fulfilled = false,
			promise = new Promise( then ),
			value;

		function then( onFulfilled, onRejected, alt, sync ) {
			var def = alt === ALT ? void 0 : defer();

			function onSettled() {
				var func = fulfilled ? onFulfilled : onRejected;

				if ( !def ) {
					func && func( value );
					return;
				}

				if ( typeof func === "function" ) {
					try {
						var res = func( value );
					} catch ( ex ) {
						def.reject( ex );
						return;
					}

					def.resolve( res );

				} else if ( fulfilled ) {
					def.resolve( value );

				} else {
					def.reject( value );
				}
			}

			if ( pending ) {
				pending.push( onSettled );

			} else if ( !def && sync ) {
				onSettled();

			} else {
				runLater( onSettled );
			}

			return def && def.promise;
		}

		var resolve = function( val ) {
			if ( pending ) {
				if ( val instanceof Promise ) {
					val.then( resolve, settle, ALT, true );

				} else if ( val && typeof val.then === "function" ) {
					runLater(function() {
						try {
							val.then( resolve, settle );
						} catch ( ex ) {
							settle( ex );
						}
					});

				} else {
					fulfilled = true;
					settle( val );
				}
			}
		};

		var settle = function( val ) {
			if ( pending ) {
				promise.state = fulfilled ? "fulfilled" : "rejected";
				promise.value = value = val;
				forEach( pending, runLater );
				pending = null;
			}
		};

		return {
			promise: promise,
			resolve: resolve,
			reject: settle
		};
	}


	function Promise( then ) {
		this.then = then;
		this.state = "pending";
		this.value = void 0;
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
		}, ALT);
	};

	Promise.prototype.spread = function( cb, eb ) {
		return this.then(cb && function( values ) {
			return cb.apply( void 0, values );
		}, eb);
	};

	Promise.prototype.timeout = function( ms ) {
		var def = defer();
		var timeoutId = setTimeout(function() {
			def.reject( new Error("Timed out after " + ms + " ms") );
		}, ms);

		this.when(function( value ) {
			clearTimeout( timeoutId );
			def.resolve( value );
		}, function( error ) {
			clearTimeout( timeoutId );
			def.reject( error );
		}, ALT, true);

		return def.promise;
	};

	Promise.prototype.delay = function( ms ) {
		var self = this;
		var def = defer();
		setTimeout(function() {
			def.resolve( self );
		}, ms);
		return def.promise;
	};

	P.all = all;
	function all( promises ) {
		var waiting = 0;
		var def = defer();
		each( promises, function( promise, index ) {
			++waiting;
			P( promise ).then(function( value ) {
				promises[ index ] = value;
				if ( --waiting === 0 ) {
					def.resolve( promises );
				}
			}, def.reject, ALT );
		});
		if ( waiting === 0 ) {
			def.resolve( promises );
		}
		return def.promise;
	}

	// P.allResolved is DEPRECATED!
	P.allSettled = P.allResolved = allSettled;
	function allSettled( promises ) {
		var waiting = 1;
		var def = defer();
		function callback() {
			if ( --waiting === 0 ) {
				def.resolve( promises );
			}
		}
		each( promises, function( promise, index ) {
			++waiting;
			promises[ index ] = promise = P( promise );
			promise.then( callback, callback, ALT );
		});
		callback();
		return def.promise;
	}

	P.onerror = null;

	P.prototype = Promise.prototype;

	P.nextTick = function( f ) {
		runLater( f, true );
	};

	P.ALT = ALT;

	P._each = each;

	//P.runLater = runLater;

	return P;
});
