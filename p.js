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
		isArray;

	function onTick() {
		--pendingTicks;
		while ( head.n ) {
			head = head.n;
			if ( head.w ) {
				--neededTicks;
			}
			var f = head.f;
			head.f = null;
			f();
		}
		nextNeedsTick = true;
	}

	var runLater = function( f, couldThrow ) {
		if ( nextNeedsTick && ++neededTicks > pendingTicks ) {
			++pendingTicks;
			requestTick( onTick, 0 );
		};
		tail = tail.n = { f: f, w: nextNeedsTick, n: null };
		nextNeedsTick = couldThrow === true;
	};

	function ot( type ) {
		return type === "object" || type === "function";
	}

	function ft( type ) {
		return type === "function";
	}

	if ( ft(typeof setImmediate) ) {
		requestTick = wow ?
			function( cb ) {
				wow.setImmediate( cb );
			} :
			function( cb ) {
				setImmediate( cb );
			};

	} else if ( ot(typeof process) && process && ft(typeof process.nextTick) ) {
		requestTick = process.nextTick;
		//runLater = process.nextTick;

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

	function reportError( error ) {
		runLater(function() {
			if ( P.onerror ) {
				P.onerror( error );
			} else {
				throw error;
			}
		}, true);
	}

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

	var CHECK = {};
	var RESOLVE = 0;
	var FULFILL = 1;
	var REJECT  = 2;

	P.defer = defer;
	function defer() {
		var pending = [],
			validToken = 0,
			testToken = 0,
			fulfilled = false,
			value;

		function H( action ) {
			var token = validToken;
			return function( x ) {
				testToken = token;
				resolve( x, CHECK, action );
			};
		}

		function then( onFulfilled, onRejected, _done, _sync ) {
			var def = _done === CHECK ? void 0 : defer();

			function onSettled() {
				var func = fulfilled ? onFulfilled : onRejected;

				if ( typeof func === "function" ) {
					try {
						var res = func( value );

					} catch ( ex ) {
						def ? def.reject( ex ) : reportError( ex );
						return;
					}

					def && def.resolve( res );

				} else if ( def ) {
					def.resolve( value, CHECK, fulfilled ? FULFILL : REJECT );

				} else if ( !fulfilled ) {
					reportError( value );
				}
			}

			if ( pending ) {
				pending.push( onSettled );

			} else if ( _sync === CHECK ) {
				onSettled();

			} else {
				runLater( onSettled );
			}

			return def && def.promise;
		}


		function resolve( x, _check, _action ) {
			if ( testToken !== validToken ) {
				return;
			}

			++validToken;
			_action = _check === CHECK && _action;

			if ( _action || x !== Object(x) ) {
				fulfilled = _action !== REJECT;
				value = x;
				forEach( pending, runLater );
				pending = null;
				return;
			}

			if ( x instanceof Promise ) {
				x.then( H(FULFILL), H(REJECT), CHECK, CHECK );
				return;
			}

			runLater(function() {
				var action = 0;

				try {
					var then = x.then;

					if ( typeof then === "function" ) {
						then.call( x, H(RESOLVE), H(REJECT) );

					} else {
						action = FULFILL;
					}

				} catch ( ex ) {
					x = ex;
					action = REJECT;
				}

				if ( action ) {
					testToken = validToken;
					resolve( x, CHECK, action );
				}
			});
		}

		return {
			promise: new Promise( then ),
			resolve: resolve,
			reject: H(REJECT)
		};
	}


	function Promise( then ) {
		this.then = then;
	}

	Promise.prototype.done = function( cb, eb ) {
		this.then( cb, eb, CHECK );
	};

	Promise.prototype.spread = function( cb, eb ) {
		return this.then(cb && function( array ) {
			return all( array ).then(function( values ) {
				return cb.apply( void 0, values );
			});
		}, eb);
	};

	Promise.prototype.timeout = function( ms ) {
		var def = defer();
		var timeoutId = setTimeout(function() {
			def.reject( new Error("Timed out after " + ms + " ms") );
		}, ms);

		this.then(function( value ) {
			clearTimeout( timeoutId );
			def.resolve( value );
		}, function( error ) {
			clearTimeout( timeoutId );
			def.reject( error );
		}, CHECK, CHECK);

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
		var waiting = 1;
		var def = defer();
		each( promises, function( promise, index ) {
			++waiting;
			P( promise ).then(function( value ) {
				promises[ index ] = value;
				if ( --waiting === 0 ) {
					def.resolve( promises );
				}
			}, def.reject, CHECK, CHECK );
		});
		if ( --waiting === 0 ) {
			def.resolve( promises );
		}
		return def.promise;
	}

	P.onerror = null;

	P.prototype = Promise.prototype;

	P.nextTick = function( f ) {
		runLater( f, true );
	};

	P._each = each;

	return P;
});
