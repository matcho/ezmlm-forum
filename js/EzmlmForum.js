/**
 * Convenience parent class gathering config params and utility methods
 */
function EzmlmForum() {
	this.config = {};
	this.listRoot = '';
	this.appLoadedOnce = false;
	// text enriching options
	this.enrich = {
		media: false,
		links: true,
		binettes: false
	};
	this.calendarOptions = {
		sameDay: 'HH:mm',
		lastDay: '[hier à] HH:mm',
		nextDay: '[demain à] HH:mm',
		lastWeek: 'dddd [à] HH:mm',
		nextWeek: 'dddd [prochain à] HH:mm', // doesn't work => WTF ?
		sameElse: 'DD/MM YYYY'
	};
	this.runningQuery = null;
	this.auth = null;
	// absolute links everywhere
	this.linkBase = null;

	// list
	this.detailsData = null;
	this.threadsData = null;
	this.messagesData = null;
	this.calendarData = null;
	this.mode = null; // "threads" or "messages"
	this.defaultMode = 'threads';
	this.sortDirection = null;
	this.defaultSortDirection = 'desc';
	this.offset = 0;
	this.limit = 10;
	this.searchMode = null;
	this.searchTerm = null;

	// thread
	this.threadHash = null;
	this.sortDirection = 'asc';
	this.detailsData = null;
	this.messagesData = null;
	this.offset = 0;
	this.initialLimit = 3;
	this.limit = null;
	this.avatarCache = {};
}

// ------------------------------------- List view -----------------------------

/**
 * Reads the list's calendar, displays it under the "by-date" button, calls cb()
 * at the end whatever happens
 */
EzmlmForum.prototype.readCalendar = function(cb) {
	var lthis = this;
	// list info
	var url = this.listRoot + '/calendar';
	$jq.get(url)
	.done(function(data) {
		lthis.calendarData = data;
	})
	.fail(function() {
		console.log('failed to fetch calendar data');
	})
	.always(function() {
		//console.log('ALWAYS COCA CALLBACK');
		cb();
	});
};

/**
 * Reads the list's details, displays them
 */
EzmlmForum.prototype.readDetails = function() {
	var lthis = this;
	var infoBoxData = {
		list_name: lthis.config['ezmlm-php'].list,
		display_title: lthis.config['displayListTitle'],
		link_base: lthis.linkBase
	};
	// list info
	$jq.get(this.listRoot)
	.done(function(data) {
		lthis.detailsData = data;
		//console.log(lthis.detailsData);
		// display
		lthis.detailsData.first_message.message_date_moment = lthis.momentize(lthis.detailsData.first_message.message_date);
		lthis.detailsData.last_message.message_date_moment = lthis.momentize(lthis.detailsData.last_message.message_date);
		// email censorship
		lthis.detailsData.first_message.author_name = lthis.censorEmail(lthis.detailsData.first_message.author_name);
		lthis.detailsData.last_message.author_name = lthis.censorEmail(lthis.detailsData.last_message.author_name);

		infoBoxData.list = lthis.detailsData;

		// page title
		if (lthis.config.rewritePageTitle) {
			document.title = lthis.config['ezmlm-php'].list + ' (' + lthis.mode + ')';

			if (lthis.config.title && lthis.config.title != "") {
				document.title += ' - ' + lthis.config.title;
			}
		}

		lthis.renderTemplate('list-info-box', infoBoxData);
		// bye
	})
	.fail(function() {
		console.log('failed to fetch list details');
		lthis.renderTemplate('list-info-box', infoBoxData);
	});
}

/**
 * Tools need to read the list calendar - suboptimal cause we could read it
 * only once...
 */
EzmlmForum.prototype.loadTools = function() {
	//console.log('load tools and calendar !');
	var lthis = this;
	this.readCalendar(function() {
		// format calendar data for Mustache
		var calendar = [];
		//console.log(lthis.calendarData);
		$jq.each(lthis.calendarData, function(k, v) {
			var yearData = {
				year: k
			};
			yearData.months = [];
			var allMonths = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
			for (var i=0; i < allMonths.length; i++) {
				yearData.months.push({
					yearAndMonth: k + '-' + allMonths[i],
					month: allMonths[i],
					count: v[allMonths[i]]
				});
			}
			// sort by month ascending
			yearData.months.sort(function(a, b) {
				return parseInt(a.month) - parseInt(b.month);
			});
			calendar.push(yearData);
		});
		// sort by year descending
		calendar.sort(function(a, b) {
			return parseInt(b.year) - parseInt(a.year);
		});
		//console.log(calendar);
		// render
		lthis.renderTemplate('list-tools-box', {
			messagesMode: (lthis.mode == 'messages'),
			threadsMode: (lthis.mode == 'threads'),
			textSearchMode: (lthis.searchMode == 'search'),
			searchTerm: lthis.searchTerm != null ? decodeURI(lthis.searchTerm) : '',
			calendar: calendar,
			mode: lthis.mode,
			urlSearchTerm: (lthis.searchTerm || '*'),
			offset: lthis.offset,
			sortDirection: lthis.sortDirection,
			noPostRights: (! lthis.auth.user.rights.post),
			link_base: lthis.linkBase
		});
	});
};

EzmlmForum.prototype.showThreadsOrMessages = function() {
	var lthis = this;
	function done() {
		lthis.stopWorking();
		lthis.pushAppState();
	}
	$jq('#list-threads').html('');
	$jq('#list-messages').html('');
	this.startWorking();
	if (this.mode == 'messages') {
		this.readMessages(done);
	} else {
		this.readThreads(done);
	}
};

/**
 * Reads, searches, filters latest threads and displays them adequately; calls
 * cb() at the end
 */
EzmlmForum.prototype.readThreads = function(cb) {
	var lthis = this;
	this.abortQuery(); // if messages are being read, stop it

	// post-callbacks work
	function displayThreads() {
		// threads
		var threads = lthis.threadsData.results;
		for (var i=0; i < threads.length; ++i) {
			// format dates
			threads[i].last_message.message_date_moment = lthis.momentize(threads[i].last_message.message_date);
			// in case some fields are empty or false
			if (threads[i].subject == "") threads[i].subject = "n/a";
			if (! threads[i].first_message.author_name) threads[i].first_message.author_name = "n/a";
			// email censorship
			threads[i].first_message.author_name = lthis.censorEmail(threads[i].first_message.author_name);
		}

		var currentPage = 1
			totalPages = Math.floor(lthis.threadsData.total / lthis.limit);
		if (lthis.threadsData.total % lthis.limit != 0) {
			totalPages++;
		}
		if (lthis.offset > 0) {
			currentPage = Math.floor(lthis.offset / lthis.limit) + 1;
		}
		var templateData = {
			threads: threads,
			link_base: lthis.linkBase,
			searchMode: lthis.searchMode,
			searchTerm: (lthis.searchTerm || '*'),
			sortDirection: lthis.sortDirection,
			sortAsc: (lthis.sortDirection == 'asc'),
			sortTitle: (lthis.sortDirection == 'asc' ? "Les plus anciens d'abord" : "Les plus récents d'abord"),
			displayedThreads: lthis.threadsData.count,
			totalThreads: lthis.threadsData.total,
			moreThreads: (lthis.threadsData.total - lthis.threadsData.count > 0),
			pager: {
				currentPage: currentPage,
				totalPages: totalPages,
				hasNextPages: (currentPage < totalPages),
				hasPreviousPages: (currentPage > 1),
				previousOffset: Math.max(0, lthis.offset - lthis.limit),
				nextOffset: lthis.offset + lthis.limit,
				totalResults: lthis.threadsData.total
			}
		};
		lthis.renderTemplate('list-threads', templateData);
		lthis.reloadEventListeners();
		cb();
	}

	// list threads
	var url = this.listRoot + '/threads/';
	if (this.searchTerm) {
		url += this.searchMode + '/';
		var st = this.searchTerm;
		if (this.searchMode == "search") {
			st = '*' + st + '*';
		}
		url += st + '/';
	}
	url += '?sort=' + this.sortDirection
		+ (this.offset ? '&offset=' + this.offset : '')
		+ (this.limit ? '&limit=' + this.limit : '')
		+ '&details=true'
	;
	this.runningQuery = $jq.get(url)
	.done(function(data) {
		lthis.threadsData = data;
		//console.log(lthis.threadsData);
	})
	.fail(function() {
		lthis.threadsData = { results: [] };
		console.log('failed to fetch threads');
	})
	.always(displayThreads);
};


/**
 * Reads, searches, filters latest messages and displays them adequately; calls
 * cb() at the end
 */
EzmlmForum.prototype.readMessages = function(cb) {
	var lthis = this;
	this.abortQuery(); // if threads are being read, stop it

	// post-callbacks work
	function displayMessages() {
		// messages
		var messages = lthis.messagesData.results;
		for (var i=0; i < messages.length; ++i) {
			// format text
			messages[i].message_contents.text = lthis.cleanText(messages[i].message_contents.text, true);
			// format dates
			messages[i].message_date_moment = lthis.momentize(messages[i].message_date);
		}

		var currentPage = 1
			totalPages = Math.floor(lthis.messagesData.total / lthis.limit);
		if (lthis.messagesData.total % lthis.limit != 0) {
			totalPages++;
		}
		if (lthis.offset > 0) {
			currentPage = Math.floor(lthis.offset / lthis.limit) + 1;
		}
		var templateData = {
			messages: messages,
			link_base: lthis.linkBase,
			searchTerm: (lthis.searchTerm || '*'),
			searchMode: lthis.searchMode,
			sortDirection: lthis.sortDirection,
			sortAsc: (lthis.sortDirection == 'asc'),
			sortTitle: (lthis.sortDirection == 'asc' ? "Les plus anciens d'abord" : "Les plus récents d'abord"),
			displayedMessages: lthis.messagesData.count,
			totalMessages: lthis.messagesData.total,
			moreMessages: (lthis.messagesData.total - lthis.messagesData.count > 0),
			pager: {
				currentPage: currentPage,
				totalPages: totalPages,
				hasNextPages: (currentPage < totalPages),
				hasPreviousPages: (currentPage > 1),
				previousOffset: Math.max(0, lthis.offset - lthis.limit),
				nextOffset: lthis.offset + lthis.limit,
				totalResults: lthis.messagesData.total
			}
		};
		lthis.renderTemplate('list-messages', templateData);
		lthis.reloadEventListeners();
		cb();
	}

	// list messages
	var url = this.listRoot + '/messages/';
	if (this.searchTerm) {
		url += this.searchMode + '/';
		var st = this.searchTerm;
		if (this.searchMode == "search") {
			st = '*' + st + '*';
		}
		url += st + '/';
	}
	url	+= '?contents=abstract'
		+ '&sort=' + this.sortDirection
		+ (this.offset ? '&offset=' + this.offset : '')
		+ (this.limit ? '&limit=' + this.limit : '')
	;
	this.runningQuery = $jq.get(url)
	.done(function(data) {
		lthis.messagesData = data;
		//console.log(lthis.messagesData);
	})
	.fail(function() {
		lthis.messagesData = { results: [] };
		console.log('failed to fetch messages');
	})
	.always(displayMessages);
};

EzmlmForum.prototype.search = function() {
	var term = $jq('#list-tool-search-input').val();
	//console.log('push search: [' + term + ']')
	// search bar should be a form to avoid this trick
	this.pushAppState(this.mode, "search", term, 0);
};

/**
 * Updates URL route-like fragment so that it reflects app state; this is
 * supposed to push a history state (since URL fragment has changed)
 */
EzmlmForum.prototype.pushAppState = function(mode, searchMode, searchTerm, offset, sortDirection) {
	// @TODO get rid of this as soon as the app is merged into one page
	if (! window.location.pathname.endsWith('/')) {
		window.location.pathname += '/';
	}
	if (searchTerm == '') {
		searchTerm = '*';
	}
	if (offset == undefined) {
		offset = this.offset;
	}
	var fragment = '#!';
	fragment += '/' + (mode || this.mode);
	fragment += '/' + (searchMode || this.searchMode);
	fragment += '/' + (searchTerm || (this.searchTerm ? this.searchTerm : '*'));
	fragment += '/' + offset;
	fragment += '/' + (sortDirection || this.sortDirection);
	//console.log('pushing framgment: [' + fragment + ']');
	// @TODO date search
	window.location.hash = fragment;
};

/**
 * Reads URL route-like fragment to load app state
 */
EzmlmForum.prototype.readAppState = function() {
	var fragment = window.location.hash;
	//console.log('fragment: [' + fragment + ']');
	var parts = fragment.split('/');
	// remove '#!';
	parts.shift();
	//console.log(parts);
	if (parts.length == 5) { // all or nothing
		this.mode = parts[0];
		this.searchMode = parts[1];
		this.searchTerm = (parts[2] == '*' ? null : parts[2]);
		//console.log('AAAA searchTerm: [' + this.searchTerm + '], nst: [' + (parts[2] == '*' ? null : parts[2]) + ']');
		this.offset = parseInt(parts[3]);
		this.sortDirection = parts[4];
	}
};

/**
 * Reads app state then calls services to update rendering
 * - triggered by hashchange
 */
EzmlmForum.prototype.loadAppStateFromUrl = function() {
	var previousMode = this.mode,
		previousSearchMode = this.searchMode,
		previousSearchTerm = this.searchTerm,
		previousOffset = this.offset,
		previousSortDirection = this.sortDirection;

	// from URL
	this.readAppState();
	//console.log('EzmlmForum.intelligentReload()');
	// intelligent reload
	//console.log('searchTerm: [' + this.searchTerm + '], pst: [' + previousSearchTerm + ']');
	//console.log('searchMode: [' + this.searchMode + '], psm: [' + previousSearchMode + ']');
	var needsDetails = ! this.appLoadedOnce,
		needsTools = (needsDetails || this.mode != previousMode || this.searchTerm != previousSearchTerm || this.searchMode != previousSearchMode),
		needsContents = (needsTools || this.offset != previousOffset || this.sortDirection != previousSortDirection);
	if (needsDetails) {
		//console.log('-- reload details');
		this.readDetails();
	}
	if (needsTools) {
		//console.log('-- reload tools');
		this.loadTools();
	}
	if (needsContents) {
		//console.log('-- reload contents');
		this.showThreadsOrMessages();
	}
};

// ------------------------------------- Thread view ---------------------------

/**
 * Reads the thread's details, displays them, and calls cb() or err() at the end
 * respectively if everything went ok or if an error occurred
 */
EzmlmForum.prototype.readDetails = function(cb) {
	//console.log('read details');
	var lthis = this;
	var infoBoxData = {
		link_base: lthis.linkBase,
		hash: lthis.threadHash
	};

	// thread info
	$jq.get(this.listRoot + '/threads/' + this.threadHash + '?details')
	.done(function(data) {
		lthis.detailsData = data;
		//console.log(lthis.detailsData);
		// display
		lthis.detailsData.thread.first_message.message_date_moment = lthis.momentize(lthis.detailsData.thread.first_message.message_date);
		lthis.detailsData.thread.last_message.message_date_moment = lthis.momentize(lthis.detailsData.thread.last_message.message_date);
		// email censorship
		lthis.detailsData.thread.first_message.author_name = lthis.censorEmail(lthis.detailsData.thread.first_message.author_name);
		lthis.detailsData.thread.last_message.author_name = lthis.censorEmail(lthis.detailsData.thread.last_message.author_name);

		infoBoxData = lthis.detailsData;
		// page title
		if (lthis.config.rewritePageTitle) {
			document.title = lthis.detailsData.thread.subject + ' (' + lthis.config['ezmlm-php'].list + ') - ' + lthis.config.title;
		} else {
			document.title += ' - ' + lthis.detailsData.thread.subject;
		}

		lthis.renderTemplate('thread-info-box', infoBoxData);
		// bye
		cb();
	})
	.fail(function() {
		console.log('failed to fetch details');
		lthis.renderTemplate('thread-info-box', infoBoxData);
	});
};

/**
 * Clears the messages, displays wait animation, waits a few seconds
 * (5 by default) and reloads thread messages, hoping that the newly sent one
 * will be visible (ie. ezmlm-idx had enough time to index it)
 */
EzmlmForum.prototype.waitAndReadThread = function(seconds) {
	var lthis = this;
	seconds = seconds || 5; // default wait : 5s
	var milliseconds = seconds * 1000;
	$jq('#thread-messages').html("");
	this.startWorking();
	setTimeout(function() {
		lthis.readThread();
	}, milliseconds);
};

/**
 * Reads all messages in a thread and displays them adequately; be sure to have
 * read thread details data before (at least once)
 */
EzmlmForum.prototype.readThread = function() {
	//console.log('read thread');
	var lthis = this;
	this.startWorking();

	// post-callbacks work
	function displayThread() {
		// messages
		var messages = lthis.messagesData.results;
		for (var i=0; i < messages.length; ++i) {
			// format text
			if (messages[i].message_contents) {
				messages[i].quoted_message_id = lthis.detectQuotedMessageId(messages[i].message_contents.text); // do this before cleaning
				messages[i].message_contents.text = lthis.cleanText(messages[i].message_contents.text);
				// censor all email adresses in the message
				// @TODO maybe apply to quoted messages headers only ?
				messages[i].message_contents.text = lthis.censorEmail(messages[i].message_contents.text, true);
				messages[i].message_contents.text = lthis.enrichText(messages[i].message_contents.text);
			}
			// format dates
			messages[i].message_date_moment = lthis.momentize(messages[i].message_date);
			// @TODO detect attachments mimetype family and use appropriate
			// glyphicon from Boostrap (video, picture, audio...)
			// detect original author
			messages[i].from_original_author = (lthis.detailsData.thread.first_message.author_hash == messages[i].author_hash);
			// email censorship
			messages[i].author_name = lthis.censorEmail(messages[i].author_name);
			// detect first message
			messages[i].is_first_message = (lthis.detailsData.thread.first_message_id == messages[i].message_id);
			// need to explicitely show quote (distance > 1) ?
			messages[i].needs_quotation = (messages[i].quoted_message_id != null) && (messages[i].message_id - messages[i].quoted_message_id > 1);
		}

		var templateData = {
			messages: messages,
			link_base: lthis.linkBase,
			sortAsc: (lthis.sortDirection == 'asc'),
			sortTitle: (lthis.sortDirection == 'asc' ? "Les plus anciens d'abord" : "Les plus récents d'abord"),
			displayedMessages: lthis.messagesData.count,
			//totalMessages: lthis.detailsData.thread.nb_messages,
			//moreMessages: (lthis.detailsData.thread.nb_messages - lthis.messagesData.count > 0)
			totalMessages: lthis.messagesData.total,
			moreMessages: (lthis.messagesData.total - lthis.messagesData.count > 0),
			noPostRights: (! lthis.auth.user.rights.post)
		};
		lthis.renderTemplate('thread-messages', templateData);

		// other
		lthis.stopWorking();
		lthis.reloadEventListeners();
		// fetch avatars
		lthis.fetchAvatars();
	}

	// thread messages
	var url = this.listRoot + '/threads/' + this.threadHash + '/messages?contents=true'
		+ '&sort=' + this.sortDirection
		+ (this.offset ? '&offset=' + this.offset : '')
		+ (this.limit ? '&limit=' + this.limit : '');

	$jq.get(url)
	.done(function(data) {
		lthis.messagesData = data;
		//console.log(lthis.messagesData);
	})
	.fail(function() {
		console.log('failed to fetch messages');
	})
	.always(displayThread);
};

// doesn't work
EzmlmForum.prototype.addPreviousMessageHtmlQuotation = function(id) {
	var quotation = '';
	// no <br/> because rawMessageToHtml() always leaves at least 2 at the end
	// @TODO do this better, manage languages, test if it works
	quotation += "----- Original message -----<br/>";
	var previousMessage = $jq('#msg-' + id).find('.message-contents').html();
	// remove previous quotations
	previousMessage = previousMessage.replace(/<a.+class="message-read-more".*/gi, '');
	quotation += previousMessage;
	return quotation;
};

EzmlmForum.prototype.sortByDate = function() {
	//console.log('sort by date');
	this.sortDirection = (this.sortDirection == 'desc' ? 'asc' : 'desc');
	this.limit = this.initialLimit;
	// refresh messages + tools template
	this.readThread();
};

EzmlmForum.prototype.loadMoreMessages = function() {
	//console.log('loadMoreMessages');
	this.limit = null;
	// refresh messages + tools template
	this.readThread();
};

EzmlmForum.prototype.addQuoteToOutgoingMessage = function(message, quotedMessageId) {
	message += "\n\n";
	message += "++++++" + quotedMessageId + "++++++";
	message += "\n";
	return message;
};

EzmlmForum.prototype.detectQuotedMessageId = function(text) {
	var quotedId = null,
		pattern = /\+\+\+\+\+\+([0-9]+)\+\+\+\+\+\+/;
	// ^ and $ don't work here => wtf ?
	// Search only one pattern from the beggining, which should be the latest
	// quotation, ignoring quotations present in messages replies not yet cleaned

	var matches = pattern.exec(text);
	if (matches != null && matches.length == 2) {
		quotedId = matches[1];
	}
	return quotedId;
};

/**
 * For every author currently displayed, fetch and display the avatar
 */
EzmlmForum.prototype.fetchAvatars = function() {
	//console.log("récupération d'avatars !");
	var lthis = this;
	$jq('.thread-message').each(function() {
		var avatar = null;
		var currentElement = $jq(this);
		var messageId = currentElement.attr('id').substr(4);
		// get author email
		var authorEmail = lthis.getAuthorEmailFromMsgId(messageId);
		if (authorEmail != null) {
			// is the avatar already in the cache ?
			if (authorEmail in lthis.avatarCache) {
				//console.log('trouvé dans le cache : ' + lthis.avatarCache[authorEmail]);
				avatar = lthis.avatarCache[authorEmail];
				if (avatar != null) {
					// display it !
					currentElement.find('.author-image > img').attr('src', avatar);
				}
			} else {
				// fetch it using the service, if configured
				if (('avatarService' in lthis.config) && (lthis.config.avatarService != '')) {
					var url = lthis.config.avatarService.replace('{email}', authorEmail);
					var currentThreadMessage = this;
					$jq.getJSON(url)
					.done(function(avatar) {
						//console.log("je l'ai : " + avatar);
						// cache it even if null, to avoid more useless requests
						lthis.avatarCache[authorEmail] = avatar;
						if (avatar != null) {
							// display it !
							$jq(currentThreadMessage).find('.author-image > img').attr('src', avatar);
						}
					})
					.fail(function() {
						console.log('failed to fetch avatar');
						// fallback
						lthis.generateInitialsAvatar(currentElement, messageId);
					});
				} else {
					// fallback
					lthis.generateInitialsAvatar(currentElement, messageId);
				}
			}
		}
	});
};

/**
 * If no avatar was found for this author, tries to generate 2 initials based on
 * his/her name, and associate a (deterministic) background color
 */
EzmlmForum.prototype.generateInitialsAvatar = function(element, msgId) {
	var initials = this.computeInitials(msgId);

	if (initials) {
		var authorImage = element.find('.author-image');
		authorImage.find('img').attr('src', null);
		authorImage.html(initials);
		var color = this.computeColor(initials);
		authorImage.css('background-color', color);
		authorImage.addClass('author-initials');
	} // else keep the default image
};

/**
 * Generates a 2-letter string of initiales based on an author's name
 * 
 * @param {int} msgId id of the message to retrieve the author from
 * @returns false if it failed, a 2-letter string otherwise
 */
EzmlmForum.prototype.computeInitials = function(msgId) {
	var authorName = this.getAuthorNameFromMsgId(msgId);
	if (authorName) {
		var pieces = authorName.split(' ');
		//console.log(pieces);
		if (pieces.length >= 2) {
			return pieces[0].substring(0,1) + pieces[1].substring(0,1);
		}
	}
	return false;
};

/**
 * Picks a color among a predefined list, based on a given string (2-letter
 * initials)
 * @TODO choose better colors / use npm lib (for ex. google-colors)
 */
EzmlmForum.prototype.computeColor = function(initials) {
	var colors = ['#F1D133', '#F4754F', '#EAF44F', '#8DE56E', '#6EE5C7', '#89DCEF', '#D7DDFE', '#DABBED', '#FB81E6', '#CECECE'];
	var hash = initials.hashCode();
	var color = colors[hash % colors.length];
	return color;
};

/**
 * Retrieves the author email address given a message id; see getFieldFromMsgId
 */
EzmlmForum.prototype.getAuthorEmailFromMsgId = function(messageId) {
	return this.getFieldFromMsgId(messageId, 'author_email');
};

/**
 * Retrieves the author name given a message id; see getFieldFromMsgId
 */
EzmlmForum.prototype.getAuthorNameFromMsgId = function(messageId) {
	return this.getFieldFromMsgId(messageId, 'author_name');
};

/**
 * Retrieves a message field given a message id and the field name;
 * needs to have called readThread() at least once (messagesData must be loaded)
 */
EzmlmForum.prototype.getFieldFromMsgId = function(messageId, fieldName) {
	var authorEmail = null,
		msgs = this.messagesData.results,
		i = 0;
	while (authorEmail == null && i < msgs.length) {
		if (msgs[i].message_id == messageId) {
			authorEmail = msgs[i][fieldName];
		}
		i++;
	}
	return authorEmail;
};


/**
 * Clears the list, displays wait animation, waits a few seconds
 * (5 by default) and reloads what was loaded before (messages or threads),
 * hoping that the newly sent subject will be visible (ie. ezmlm-idx had enough
 * time to index it)
 */
EzmlmForum.prototype.waitAndReload = function(seconds) {
	var lthis = this;
	seconds = seconds || 5; // default wait : 5s
	var milliseconds = seconds * 1000;
	// @TODO make it more generic
	$jq('#list-threads').html("");
	$jq('#list-messages').html("");
	this.startWorking();
	setTimeout(function() {
		if (lthis.mode == "messages") {
			//console.log('reload messages after timeout');
			lthis.readMessages(function() {
				lthis.stopWorking();
			});
		} else {
			//console.log('reload threads after timeout');
			lthis.readThreads(function() {
				lthis.stopWorking();
			});
		}
	}, milliseconds);
};

// ------------------------------------- Common stuff --------------------------


/**
 * Redefines all event listeners ;to be called after any event-prone content has
 * been loaded
 */
EzmlmForum.prototype.reloadEventListeners = function() {
	var lthis = this;
	console.log('reload event listeners !');

	// list

	// show thread details
	$jq('.list-tool-info-details').unbind().click(function(e) {
		// @TODO use closest() to genericize for multiple instances ?
		e.preventDefault();
		$jq('.list-info-box-details').toggle();
		return false;
	});

	// search messages / threads
	$jq('#list-tool-search').unbind().click(function(e) {
		e.preventDefault();
		lthis.search();
		return false;
	});
	// press Return to search
	$jq('#list-tool-search-input').unbind().keypress(function(e) {
		if (e.which == 13) { // "return" key
			lthis.search();
		}
	});

	// show new thread area
	$jq('.list-tool-new-thread').unbind().click(function(e) {
		e.preventDefault();
		var newThreadArea = $jq('#new-thread');
		// show new thread area
		newThreadArea.show();
		return false;
	});

	// cancel the new thread
	$jq('#cancel-new-thread').unbind().click(function(e) {
		e.preventDefault();
		var newThreadArea = $jq('#new-thread'),
			threadTitle = $jq('#new-thread-title'),
			threadBody = $jq('#new-thread-body'),
			doCancel = true;

		if (threadTitle.val() != '' || threadBody.val() != '' ) {
			doCancel = confirm('Annuler le nouveau sujet ?');
		}
		if (doCancel) {
			threadTitle.val("");
			threadBody.val("");
			newThreadArea.hide();
		}
		return false;
	});

	// send the new thread
	$jq('#send-new-thread').unbind().click(function(e) {
		e.preventDefault();
		var newThreadArea = $jq('#new-thread'),
			threadTitle = $jq('#new-thread-title'),
			threadBody = $jq('#new-thread-body'),
			doSend = true;

		if (threadTitle.val() != '' && threadBody.val() != '' ) {
			doSend = confirm('Envoyer le nouveau sujet ?');
		} else {
			alert("Merci de saisir un titre et un message");
		}

		if (doSend) {
			//console.log('POST new thread !!!!');
			var messageContentsRawText = threadBody.val();
			var message = {
				body: lthis.rawMessageToHtml(messageContentsRawText),
				body_text: messageContentsRawText,
				subject: threadTitle.val(),
				html: true
				// @TODO support attachments
			};
			//console.log(message);
			$jq.post(lthis.listRoot + '/messages', JSON.stringify(message))
			.done(function() {
				//console.log('post new thread OK');
				threadTitle.val("");
				threadBody.val("");
				newThreadArea.hide();
				// minimalist way of waiting a little for the new message to be
				// archived by ezmlm
				lthis.waitAndReload(3);
			})
			.fail(function() {
				console.log('failed to post new thread');
				alert("Erreur lors de l'envoi du nouveau sujet");
			});

		}
		return false;
	});

	// thread

	// sort messages by date
	$jq('#thread-tool-sort-date').unbind().click(function(e) {
		e.preventDefault();
		lthis.sortByDate();
		return false;
	});

	// show thread details
	$jq('.thread-tool-info-details').unbind().click(function(e) {
		e.preventDefault();
		// @TODO use closest() to genericize for multiple instances ?
		$jq('.thread-info-box-details').toggle();
		return false;
	});

	// load more messages
	$jq('.load-more-messages').unbind().click(function(e) {
		e.preventDefault();
		lthis.loadMoreMessages();
		return false;
	});

	// show reply area
	$jq('.reply-to-message').unbind().click(function(e) {
		e.preventDefault();
		var messageId = $jq(this).parent().parent().data("id");
		//console.log('reply to message #' + messageId);
		var replyArea = $jq('#reply-to-message-' + messageId),
			replyButton = $jq(this),
			sendButton = $jq(this).parent().find('.send-reply'),
			cancelButton = $jq(this).parent().find('.cancel-reply');
		// show reply area
		replyArea.show();
		// hide reply button
		replyButton.hide()
		// show send / cancel buttons
		sendButton.show();
		cancelButton.show();
		return false;
	});

	// cancel a reply
	$jq('.cancel-reply').unbind().click(function(e) {
		e.preventDefault();
		var messageId = $jq(this).parent().parent().data("id");
		//console.log('cancel reply to message #' + messageId);
		var replyArea = $jq('#reply-to-message-' + messageId),
			replyButton = $jq(this).parent().find('.reply-to-message'),
			sendButton = $jq(this).parent().find('.send-reply'),
			cancelButton = $jq(this),
			doCancel = true;

		if (replyArea.val() != '') {
			doCancel = confirm('Annuler la réponse ?');
		}
		if (doCancel) {
			// hide reply area
			replyArea.val('');
			replyArea.hide();
			// show reply button
			replyButton.show()
			// hide send / cancel buttons
			sendButton.hide();
			cancelButton.hide();
		}
		return false;
	});

	// send a reply
	$jq('.send-reply').unbind().click(function(e) {
		e.preventDefault();
		var messageId = $jq(this).parent().parent().data("id");
		//console.log('send reply to message #' + messageId);
		var replyArea = $jq('#reply-to-message-' + messageId),
			replyButton = $jq(this).parent().find('.reply-to-message'),
			sendButton = $jq(this),
			cancelButton = $jq(this).parent().find('.cancel-reply'),
			doSend = false;

		//console.log(replyArea.val());
		if (replyArea.val() != '') {
			doSend = confirm('Envoyer la réponse ?');
		}
		if (doSend) {
			// @TODO post message !
			//console.log('POST !!!!');
			//console.log(lthis.addQuoteToOutgoingMessage(replyArea.val(), messageId));
			var messageContentsRawText = lthis.addQuoteToOutgoingMessage(replyArea.val(), messageId);
			var message = {
				body: lthis.rawMessageToHtml(messageContentsRawText),
				body_text: messageContentsRawText,
				html: true
				// @TODO support attachments
			};
			$jq.post(lthis.listRoot + '/threads/' + lthis.threadHash + '/messages', JSON.stringify(message))
			//console.log(message);
			.done(function() {
				//console.log('post message OK');
				// hide reply area
				replyArea.val('');
				replyArea.hide();
				// show reply button
				replyButton.show()
				// hide send / cancel buttons
				sendButton.hide();
				cancelButton.hide();
				// minimalist way of waiting a little for the new message to be
				// archived by ezmlm
				lthis.waitAndReadThread(3);
			})
			.fail(function() {
				console.log('failed to post message');
				alert("Erreur lors de l'envoi du message");
			});

		}
		return false;
	});

	// read more
	$jq('.message-read-more').unbind().click(function(e) {
		e.preventDefault();
		$jq(this).parent().find('.message-read-more-contents').toggle();
		return false;
	});
};

// loads the stringified JSON configuration given by PHP through the HTML view template
EzmlmForum.prototype.setConfig = function(configString) {
	//console.log('EzmlmForum.setConfig()');
	this.config = JSON.parse(configString);
	this.linkBase = this.config.domainRoot + this.config.baseUri;
	//console.log('Link base: ' + this.linkBase);
	this.listRoot = this.config['ezmlm-php'].rootUri + '/lists/' + this.config['ezmlm-php'].list;
};

// starts the job
EzmlmForum.prototype.init = function() {
	console.log('EzmlmForum.init()');
	this.initDefaults();
	var lthis = this;
	this.limit = this.initialLimit;
	//console.log(this.config);
	// bind URL (fragment) to app state
	$jq(window).on('hashchange', function() {
		//console.log('hash changed : [' + window.location.hash + ']');
		lthis.loadAppStateFromUrl();
	});
	// load auth and user info
	this.auth = new AuthAdapter(this.config);
	this.initialLoadAuth();
	// Initialize a task calling auth.load() to run every 299999 milliseconds
	// i.e. (5 min - 1 ms) to avoid JWT token expiration (15 minutes as of now).
	// Avoids useless refreshes by keeping track of the token expiration date
	// and comparing it to new Date() (i.e. now) to ensure the refresh is actually
	// needed.
	setInterval(function() {
		var now = new Date();
		if (lthis.auth.tokenExpirationTime && lthis.auth.tokenExpirationTime.getTime() - now.getTime() <= 0) {
			lthis.auth.load(function() {});
		}
	}, 299999);
};

EzmlmForum.prototype.initialLoadAuth = function() {
        var lthis = this;
	this.auth.load(function() {
		//console.log('Auth chargée');
		lthis.loadUserInfo(function() {
			//console.log(lthis.auth.user);
			// first time load
			// @WARNING it's said that Safari triggers hashchange on first time load !
			lthis.loadAppStateFromUrl();
			lthis.appLoadedOnce = true; // allows to read details only once
			/*lthis.readDetails(function() {
				lthis.readThread();
			});*/
		});
	});
};


// set default values for attributes before binding URL to app state
EzmlmForum.prototype.initDefaults = function() {
	this.mode = this.defaultMode;
	this.searchMode = "search";
	this.sortDirection = this.defaultSortDirection;
};

/**
 * Renders #tpl-{id} template inside #{id} element, using {data}
 */
EzmlmForum.prototype.renderTemplate = function(id, data) {
	var container = $jq('#' + id),
		template = $jq('#tpl-' + id).html(),
		output = Mustache.render(template, data);
	container.html(output);
};

/**
 * Detects if a text is an address email, and if so censors the domain - intended
 * for author "names" that might be bare email addresses
 *
 * If allOccurrences is true, will censor all occurrences ("g" modifier)
 */
EzmlmForum.prototype.censorEmail = function(text, allOccurrences) {
	if (allOccurrences == undefined) allOccurrences = false;
	var replacePattern = /((([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@)((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{1,64}))/i;
	if (allOccurrences) {
		replacePattern = /((([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@)((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{1,64}))/ig;
	}
	if (text && text.match(/(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{1,64}))/i)) {
		// would it be quicker to try replacing without matching ?
		text = text.replace(replacePattern, "$1...");
	}
	return text;
};

/**
 * Takes a raw message text and tries to remove the quotations / original
 * message(s) part(s) to return only the message substance
 * @TODO test and improve
 */
EzmlmForum.prototype.cleanText = function(text, remove) {
	if (remove == undefined) remove = false;
	// (.|[\r\n]) simulates the DOTALL; [\s\S] doesn't work here, no idea why
	var patterns = [
		"----- ?(Original Message|Message d'origine) ?-----", // ?
		"Date: [a-zA-Z]{3}, [0-9]{1,2} [a-zA-Z]{3} [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2}( +[0-9]{4})?", // ?
		"________________________________", // outlook
		" _____ ", // ?
		"&gt; Message du", // ? @WARNING sometimes used for Fwd messages, which means relevant contents
		"------------------------------------------------------------------------", // AVAST
		"(le|on) ([0-9]{2}(/|-)[0-9]{2}(/|-)[0-9]{4}|[0-9]{4}(/|-)[0-9]{2}(/|-)[0-9]{2}) (à )?[0-9]{2}:[0-9]{2}", // Thunderbird
		"le [0-9]{1,2} [a-zA-Z]+\.? [0-9]{4} (à )?[0-9]{2}:[0-9]{2}", // ?
		//"-------- (Message transféré|Forwarded message) --------", // ? @WARNING forwarded message might be considered as "contents"
		".*From: .+[\n\r].*(Sent|To): .+", // ?
		//".*>[\n\r\t ]+>.*", // multiples consecutive lines starting with ">" @TODO doesn't work cause of "^" and "$" added in the loop below
		"(Envoyé de mon|Sent from my) i(Phone|Pad|Mac)" // iPhone / iPad
	];

	// delete matching part, or hide it in the interface ?
	var replacement = "$1<a title=\"cliquer pour afficher / masquer les messages cités\" href=\"#\" class=\"message-read-more\">"
		//+ "..."
		+ "-- message tronqué --"
		+ "</a><div class=\"message-read-more-contents\">$3</div>";
	if (remove) {
		replacement = "$1";
	}

	// test regexs but applies only the one that cuts the text at the highest position
	var regexToApply = null,
		longestCut = 0;
	for (var i=0; i < patterns.length; ++i) {
		//var re = new RegExp("(^(.|[\r\n])+?)" + patterns[i] + "(.|[\r\n])*$", "gim");
		var re = new RegExp("(^(.|[\r\n])+?)(" + patterns[i] + "(.|[\r\n])*)$", "gim");
		var matches = re.exec(text);
		var lengthToCut = 0;
		if (matches != null && matches.length > 3) {
			//console.log(' ++ regex : [' + patterns[i] + ']');
			lengthToCut = matches[3].length;
			//console.log('ON COUPE : [' + lengthToCut + ']');
		}
		if (lengthToCut > longestCut) {
			longestCut = lengthToCut;
			//console.log('this rule is better !');
			regexToApply = patterns[i];
		}
	}
	// apply "best" regex
	if (regexToApply != null) {
		var re = new RegExp("(^(.|[\r\n])+?)(" + regexToApply + "(.|[\r\n])*)$", "gim");
		text = text.replace(re, replacement);
	}

	// remove quotations
	text = this.removeQuotations(text);

	// trim whitespaces and line breaks
	if (text) {
		text = text.replace(/[ \t\r\n]*((.|[\r\n])+)[ \t\r\n]*$/i, "$1");
	}

	return text;
};
EzmlmForum.prototype.removeQuotations = function(text) {
	if (text) {
		var pattern = /\+\+\+\+\+\+([0-9]+)\+\+\+\+\+\+/;
		// ^ and $ don't work here => wtf ?
		text = text.replace(pattern, '');
	}
	return text;
};

/**
 * Takes a raw message text and enriches it : replaces common charater sequences
 * with emoji, \n with <br>s, URL with links, images / video URLs with media
 * contents
 */
EzmlmForum.prototype.enrichText = function(text) {
	if (text) {
		if (this.enrich.media) {
			text = this.addMedia(text);
		}
		if (this.enrich.links) {
			text = this.addLinks(text);
		}
		if (this.enrich.binettes) {
			// unicode smileys
			text = Binette.binettize(text);
		}
		// @TODO detect plant scientific names
		text = this.lf2br(text); // previous regex are conditioned by \n
	}
	return text;
};
EzmlmForum.prototype.lf2br = function(text) {
	if (text) {
		// 2 or more linebreaks => 2 <br> // @TODO doesn't work so well - fix it
		//console.log('TEXTE AVANT: ' + text);
		text = text.replace(/[\r\n]{2,}/g, "<br><br>");
		// remaining (single) line breaks => 1 <br>
		//text = text.replace(/[\n]{4}/g, "<br>");
		text = text.replace(/[\r\n]/g, "<br>");
		//console.log('TEXTE APRES: ' + text);
	}
	return text;
};
EzmlmForum.prototype.addLinks = function(text) {
	if (text) {
		// [^"] excludes links in markup attributes
		text = text.replace(/([^"])(https?:\/\/[^\ ,\n\t]+)([^"])/gi, '$1<a href="$2" target="_blank">$2</a>$3');
		// why doesn't this work ??? (exclude ending ">")
		//text = text.replace(/([^"])(https?:\/\/[^\ ,\n\t>]+)([^"])/gi, '$1<a href="$2" target="_blank">$2</a>$3');
	}
	return text;
};
EzmlmForum.prototype.addMedia = function(text) {
	if (text) {
		text = this.addNativeMedia(text);
		text = this.addOnlineMediaEmbedding(text);
	}
	return text;
};
/**
 * Replaces links pointing to native media
 */
EzmlmForum.prototype.addNativeMedia = function(text) {
	if (text) {
		// image
		text = text.replace(
			/(https?:\/\/[^ ,\n]+\.(jpg|jpeg|png|gif|tif|tiff|bmp))/gi,
			'<img src="$1" class="native-media-img"/>'
		);
		// video
		text = text.replace(
			/(https?:\/\/[^ ,\n]+\.(mp4|webm|ogv|3gp))/gi,
			'<video controls src="$1" class="native-media-video" />'
		);
		// audio
		text = text.replace(
			/(https?:\/\/[^ ,\n]+\.(mp3|oga|wav))/gi,
			'<audio controls src="$1" class="native-media-audio" />'
		);
	}
	return text;
};
/**
 * Detects popular online video players URLs and replaces them with a video
 * embedding
 * @TODO manage more video hosts, not only Youtube
 */
EzmlmForum.prototype.addOnlineMediaEmbedding = function(text) {
	if (text) {
		// Youtube
		text = text.replace(
			/https?:\/\/www\.youtube\.com\/watch\?v=([^ ,\n]+)/gi,
			'<iframe class="embedded-media-video embedded-media-youtube" src="https://www.youtube.com/embed/$1" allowfullscreen></iframe>'
		);
	}
	return text;
};

/**
 * Converts a raw text message to a minimalistic readable HTML version, and
 * removes the message quotation mark (++++++N++++++)
 */
EzmlmForum.prototype.rawMessageToHtml = function(rawText) {
	var HTML = rawText;
	HTML = HTML.replace(/\+\+\+\+\+\+[0-9]+\+\+\+\+\+\+/g,'');
	HTML = HTML.replace(/\n/g,'<br/>');
	return HTML;
};

/**
 * Uses moment.js to format dates : if time difference from now is lower than
 * 45 minutes, uses moment().fromNow(); otherwise uses moment().calendar() with
 * this.calendarOptions
 */
EzmlmForum.prototype.momentize = function(date) {
	var dateMoment = null,
		age = moment().diff(moment(date), 'minutes');
	if (age > 45) {
		dateMoment = moment(date).calendar(null, this.calendarOptions);
	} else {
		dateMoment = moment(date).fromNow();
	}
	return dateMoment;
};

/**
 * Toggles work indicator panel (#work-indicator) if it exists : shows it if
 * "work" is true, hides it if "work" is false
 */
EzmlmForum.prototype.working = function(work) {
	if (work == undefined) {
		work = true;
	}
	var workIndicator = $jq('#work-indicator');
	if (workIndicator != null) {
		if (work) {
			workIndicator.show();
		} else {
			workIndicator.hide();
		}
	}
};
/**
 * shows work indicator panel
 */
EzmlmForum.prototype.startWorking = function() {
	this.working(true);
};
/**
 * hides work indicator panel
 */
EzmlmForum.prototype.stopWorking = function() {
	this.working(false);
};

/**
 * aborts any running XHR query stored in this.runningQuery
 */
EzmlmForum.prototype.abortQuery = function() {
	if (this.runningQuery != null) { // didn't manage to detect if instanceof jqXHR => wtf ?
		try {
			//console.log('aborting query');
			this.runningQuery.abort();
		} catch(e) {
			//console.log('this.runningQuery was not an XHR');
		}
	}
};

/**
 * Questions the list about what the user rights are; if user.email is null,
 * will keep the default rights set in AuthAdapter
 */
EzmlmForum.prototype.loadUserInfo = function(cb) {
	var lthis = this;
	// supposed to contain the current user's email address
	if (this.auth.user.email != null) {
		// get user's rights for the current list
		var userInfoURL = lthis.listRoot + '/users/' + lthis.auth.user.email;
		$jq.ajax({
			url: userInfoURL,
			type: "GET",
			dataType: 'json'
		}).done(function(data) {
			if (data != null && data.rights != null) {
				// overwrites default rights
				lthis.auth.user.rights = data.rights;
			}
			cb(); // load app
		}).fail(cb); // cound not get user rights; load app anyway
	} else {
		cb(); // the token seems invalid; load app anyway
	}
};


// simple hash function converting a string to an integer
// http://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/
String.prototype.hashCode = function(){
	var hash = 0;
	if (this.length == 0) return hash;
	for (i = 0; i < this.length; i++) {
		char = this.charCodeAt(i);
		hash = ((hash<<5)-hash)+char;
		hash = hash & hash; // Convert to 32bit integer
	}
	return hash;
};
