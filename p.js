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
		// f: task, w: needed a tick, n: next node
		head = { f: null, w: false, n: null }, tail = head,

		// vars for tick re-usage
		nextNeedsTick = true, pendingTicks = 0, neededTicks = 0,

		channel, // MessageChannel
		requestTick, // requestTick( onTick, 0 ) is the only valid usage!

		// window or worker
		wow = ot(typeof window) && window || ot(typeof worker) && worker;

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
			if ( i in arr ) {
				cb( arr[i], i );
			}
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
			rejected = false,
			promise = new Promise( then ),
			value;

		function then( onFulfilled, onRejected ) {
			var def = defer();

			function onReslved() {
				var func = rejected ? onRejected : onFulfilled;

				if ( typeof func === "function" ) {
					try {
						def.resolve( func( value ) );
					} catch ( ex ) {
						def.reject( ex );
					}

				} else if ( rejected ) {
					def.reject( value );

				} else {
					def.fulfill( value );
				}
			}

			if ( pending ) {
				pending.push( onReslved );

			} else {
				runLater( onReslved );
			}

			return def.promise;
		}

		function resolve( val ) {
			if ( pending ) {
				if ( val && typeof val.then === "function" ) {
					val.then( fulfill, reject );

				} else {
					fulfill( val );
				}
			}
		}

		function fulfill( val ) {
			if ( pending ) {
				promise.state = rejected ? "rejected" : "fulfilled";
				promise.value = value = val;
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
			promise: promise,
			resolve: resolve,
			fulfill: fulfill,
			reject: reject
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
		});
	};

	Promise.prototype.spread = function( cb, eb ) {
		return this.then(cb && function( values ) {
			return cb.apply( void 0, values );
		}, eb);
	};

	P.all = all;
	function all( promises ) {
		var waiting = 0;
		var def = defer();
		each(promises, function( promise, index ) {
			++waiting;
			P( promise ).then(function( value ) {
				promises[ index ] = value;
				if ( --waiting === 0 ) {
					def.fulfill( promises );
				}
			}, def.reject );
		});
		if ( waiting === 0 ) {
			def.fulfill( promises );
		}
		return def.promise;
	}

	P.allResolved = allResolved;
	function allResolved( promise ) {
		var waiting = 1;
		var def = defer();
		function callback() {
			if ( --waiting === 0 ) {
				def.fulfill( promise );
			}
		}
		each(promise, function( promise ) {
			++waiting;
			P( promise ).then( callback, callback );
		});
		callback();
		return def.promise;
	}

	P.onerror = null;

	P.prototype = Promise.prototype;

	P.nextTick = function( f ) {
		runLater( f, true );
	};

	//P.runLater = runLater;

	return P;
});
