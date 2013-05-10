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
		head = { f: null, n: null }, tail = head,
		running = false,

		channel, // MessageChannel
		requestTick, // --> requestTick( onTick, 0 )

		// window or worker
		wow = ot(typeof window) && window || ot(typeof worker) && worker,

		toStr = ({}).toString,
		isArray;

	function onTick() {
		while ( head.n ) {
			head = head.n;
			var f = head.f;
			head.f = null;
			f();
		}
		running = false;
	}

	var runLater = function( f ) {
		tail = tail.n = { f: f, n: null };
		if ( !running ) {
			running = true;
			requestTick( onTick, 0 );
		}
	};

	function ot( type ) {
		return type === "object" || type === "function";
	}

	function ft( type ) {
		return type === "function";
	}

	if ( ot(typeof process) && process && process.nextTick ) {
		requestTick = process.nextTick;

	} else if ( ft(typeof setImmediate) ) {
		requestTick = wow ?
			function( cb ) {
				wow.setImmediate( cb );
			} :
			function( cb ) {
				setImmediate( cb );
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

	function reportError( error ) {
		try {
			if ( P.onerror ) {
				P.onerror( error );
			} else {
				throw error;
			}

		} catch ( e ) {
			setTimeout(function() {
				throw e;
			}, 0);
		}
	}

	var PENDING = 0;
	var FULFILLED = 1;
	var REJECTED = 2;

	function P( x ) {
		return x instanceof Promise ?
			x :
			Resolve( new Promise(), x );
	}

	function Settle( p, state, value ) {
		if ( p._state ) {
			return p;
		}

		p._state = state;
		p._value = value;

		if ( p._pending.length > 0 ) {
			forEach( p._pending, runLater );
		}
		p._pending = null;

		return p;
	}

	function Append( p, f ) {
		p._pending.push( f );
		//p._tail = p._tail.n = { f: f, n: null };
	}

	function Resolve( p, x ) {
		if ( p._state ) {
			return p;
		}

		if ( x instanceof Promise ) {
			if ( x._state ) {
				Settle( p, x._state, x._value );

			} else {
				Append(x, function() {
					Settle( p, x._state, x._value );
				});
			}

		} else if ( x !== Object(x) ) {
			Settle( p, FULFILLED, x );

		} else {
			runLater(function() {
				try {
					var then = x.then;

					if ( typeof then === "function" ) {
						var r = resolverFor( p, x );
						then.call( x, r.resolve, r.reject );

					} else {
						Settle( p, FULFILLED, x );
					}

				} catch ( e ) {
					Settle( p, REJECTED, e );
				}
			});
		}

		return p;
	}

	function resolverFor( promise, x ) {
		var done = false;

		return {
			promise: promise,

			resolve: function( y ) {
				if ( !done ) {
					done = true;

					if ( x && x === y ) {
						Settle( promise, FULFILLED, y );

					} else {
						Resolve( promise, y );
					}
				}
			},

			reject: function( reason ) {
				if ( !done ) {
					done = true;
					Settle( promise, REJECTED, reason );
				}
			}
		};
	}

	P.defer = defer;
	function defer() {
		return resolverFor( new Promise() );
	}

	function Promise() {
		this._state = 0;
		this._value = void 0;
		this._pending = [];
	}

	Promise.prototype.then = function( onFulfilled, onRejected ) {
		var cb = typeof onFulfilled === "function" ? onFulfilled : null;
		var eb = typeof onRejected === "function" ? onRejected : null;

		var p = this;
		var p2 = new Promise();

		function onSettled() {
			var x, func = p._state === FULFILLED ? cb : eb;

			if ( func !== null ) {
				try {
					x = func( p._value );

				} catch ( e ) {
					Settle( p2, REJECTED, e );
					return;
				}

				Resolve( p2, x );

			} else {
				Settle( p2, p._state, p._value );
			}
		}

		if ( p._state === PENDING ) {
			Append( p, onSettled );

		} else {
			runLater( onSettled );
		}

		return p2;
	};

	Promise.prototype.done = function( cb, eb ) {
		var p = this;

		if ( cb || eb ) {
			p = p.then( cb, eb );
		}

		p.then( null, reportError );
	};

	Promise.prototype.fail = function( eb ) {
		return this.then( null, eb );
	};

	Promise.prototype.spread = function( cb, eb ) {
		return this.then(cb && function( array ) {
			return all( array ).then(function( values ) {
				return cb.apply( void 0, values );
			});
		}, eb);
	};

	Promise.prototype.timeout = function( ms, msg ) {
		var p = this;
		var p2 = new Promise();

		if ( p._state !== PENDING ) {
			Settle( p2, p._state, p._value );

		} else {
			var timeoutId = setTimeout(function() {
				Settle( p2, REJECTED,
					new Error(msg || "Timed out after " + ms + " ms") );
			}, ms);

			Append(p, function() {
				clearTimeout( timeoutId );
				Settle( p2, p._state, p._value );
			});
		}

		return p2;
	};

	Promise.prototype.delay = function( ms ) {
		var p = this;
		var p2 = new Promise();
		setTimeout(function() {
			Resolve( p2, p );
		}, ms);
		return p2;
	};

	P.all = all;
	function all( promises ) {
		var waiting = 0;
		var d = defer();
		each( promises, function( promise, index ) {
			var p = P( promise );
			if ( p._state === PENDING ) {
				++waiting;
				p.then(function( value ) {
					promises[ index ] = value;
					if ( --waiting === 0 ) {
						d.resolve( promises );
					}
				}, d.reject);

			} else {
				promises[ index ] = p._value;
			}
		});
		if ( waiting === 0 ) {
			d.resolve( promises );
		}
		return d.promise;
	}

	P.onerror = null;

	P.nextTick = function( f ) {
		runLater(function() {
			try {
				f();

			} catch ( ex ) {
				setTimeout(function() {
					throw ex;
				}, 0);
			}
		});
	};

	P._each = each;

	return P;
});
