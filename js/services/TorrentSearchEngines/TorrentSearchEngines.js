/**
 * Abstraction layer for the different torrent search engines that DuckieTV supports.
 * Search engines register themselves in the app's .run() block using TorrentSearchEngines.registerEngine(name, instance)
 *
 * All an engine needs to provide is a .search method. It can be both an angular factory or a plain old javascript instantiated function
 * The TorrentDialog directive lists these search engines and can switch between them.
 * The AutoDownloadService uses the default engine to look for torrents on aired episodes.
 *
 * There is a GenericTorrentSearchEngine.js in this folder that can scrape a lot of torrent sites by just passing in some endpoints and css selectors.
 * @see GenericTorrentSearch for more info or browse through the other torrent clients in this folder.
 */

DuckieTV.factory('TorrentSearchEngines', ["DuckieTorrent", "$rootScope", "dialogs", "$q", "SettingsService", "SceneNameResolver", "$http","$injector",
    function(DuckieTorrent, $rootScope, dialogs, $q, SettingsService, SceneNameResolver, $http, $injector) {
        var activeMagnet = false;
        var engines = {};
        var nativeEngines = {};
        var customEngines = {};
        var defaultEngine = 'ThePirateBay';

        function init() {
            engines = angular.copy(nativeEngines);
            return CRUD.Find("SearchEngine").then(function(results) {
                results.map(function(engine) {
                    customEngines[engine.name] = engine;
                });
                return customEngines;
            }).then(function() {
                Object.keys(customEngines).map(function(name) {
                    var engine = customEngines[name];
                    if (!engine.enabled) {
                        return;
                    }
                    console.log("Custom search engine loaded and added to default engines: ", name);
                    if(name in engines) {
                        console.warn(name, "overrides built-in search engine with the same name!");
                    }
                    engines[name] = customEngines[name].getInstance($q, $http, $injector);
                });
            })
        };

        var service = {

            registerSearchEngine: function(name, implementation) {
                name in engines ? console.info("Updating torrent search engine", name) : console.info("Registering torrent search engine:", name);
                engines[name] = nativeEngines[name] = implementation;
            },

            getSearchEngines: function() {
                return engines;
            },

            getDefaultEngine: function() {
                return engines[defaultEngine];
            },
            getDefault: function() {
                return defaultEngine;
            },
            getCustomSearchEngines: function() {
                return customEngines;
            },
            getCustomSearchEngine: function(name) {
                return customEngines[name];
            },
            getSearchEngine: function(engine) {
                if (engine in engines) {
                    return engines[engine];
                } else {
                    console.warn('search provider %s not found. default %s provider used instead.', engine, defaultEngine);
                    return engines[defaultEngine];
                }
            },

            setDefault: function(name) {
                if (name in engines) {
                    defaultEngine = name;
                }
            },

            removeSearchEngine: function(engine) {
                delete engine.customEngines[name];
                engine.deleteYourSelf().then(init);
            },

            disableSearchEngine: function(engine) {
                engine.enabled = 0;
                engine.Persist().then(init)
            },

            enableSearchEngine: function(engine) {
                engine.enabled = 1;
                engine.Persist().then(init)
            },

            findEpisode: function(serie, episode) {
                return SceneNameResolver.getSearchStringForEpisode(serie, episode).then(function(searchString) {
                    return dialogs.create('templates/dialogs/torrent.html', 'torrentDialogCtrl', {
                        query: searchString,
                        TVDB_ID: episode.TVDB_ID,
                        serie: serie,
                        episode: episode
                    }, {
                        size: 'lg'
                    });
                });

            },


            search: function(query, TVDB_ID, options) {
                return dialogs.create('templates/dialogs/torrent.html', 'torrentDialogCtrl', {
                    query: query,
                    TVDB_ID: TVDB_ID
                }, options || {
                    size: 'lg'
                });
            },
            /**
             * launch magnet via a hidden iframe and broadcast the fact that it's selected to anyone listening
             */
            launchMagnet: function(magnet, TVDB_ID) {
                console.log("Firing magnet URI! ", magnet, TVDB_ID);

                if (!SettingsService.get('torrenting.launch_via_chromium') && DuckieTorrent.getClient().isConnected()) { // fast method when using utorrent api.
                    //console.debug("Adding via TorrentClient.addMagnet API! ", magnet, TVDB_ID);
                    DuckieTorrent.getClient().addMagnet(magnet);
                    setTimeout(function() {
                        DuckieTorrent.getClient().Update(true); // force an update from torrent clients after 1.5 second to show the user that the torrent has been added.
                    }, 1500);
                    $rootScope.$broadcast('magnet:select:' + TVDB_ID, magnet.getInfoHash());
                } else {
                    var d = document.createElement('iframe');
                    d.id = 'torrentmagnet_' + new Date().getTime();
                    d.name = 'torrentmagnet_' + new Date().getTime();
                    d.style.visibility = 'hidden';
                    d.src = magnet;
                    document.body.appendChild(d);
                    //console.debug("Adding via Chromium! ", d.id, magnet, TVDB_ID);
                    var dTimer = setInterval(function () {
                        var dDoc = d.contentDocument || d.contentWindow.document;
                        if (dDoc.readyState == 'complete') {
                            document.body.removeChild(d);
                            clearInterval(dTimer);
                            return;
                        }
                    }, 1500);
                    $rootScope.$broadcast('magnet:select:' + TVDB_ID, magnet.getInfoHash());
                }
                var audio = new Audio('Exclamation.wav');
                audio.play();
            },

            launchTorrentByUpload: function(data, TVDB_ID, name) {
                console.log("Firing Torrent By data upload! ", TVDB_ID, name);

                if (DuckieTorrent.getClient().isConnected()) { // fast method when using utorrent api.
                    //console.debug("Adding via TorrentClient.addTorrentByUpload API! ", TVDB_ID, name);
                    DuckieTorrent.getClient().addTorrentByUpload(data, name).then(function(infoHash) {
                        $rootScope.$broadcast('magnet:select:' + TVDB_ID, infoHash.getInfoHash());
                    });
                    setTimeout(function() {
                        DuckieTorrent.getClient().Update(true); // force an update from torrent clients after 1.5 second to show the user that the torrent has been added.
                    }, 1500);
                }
            },

            launchTorrentByURL: function(torrentUrl, TVDB_ID, name) {
                console.log("Firing Torrent By URL! ", torrentUrl, TVDB_ID, name);

                if (!SettingsService.get('torrenting.launch_via_chromium') && DuckieTorrent.getClient().isConnected()) { // fast method when using utorrent api.
                    //console.debug("Adding via TorrentClient.addTorrentByUrl API! ", torrentUrl, TVDB_ID, name);
                    DuckieTorrent.getClient().addTorrentByUrl(torrentUrl, name).then(function(infoHash) {
                        $rootScope.$broadcast('magnet:select:' + TVDB_ID, infoHash.getInfoHash());
                    });
                    setTimeout(function() {
                        DuckieTorrent.getClient().Update(true); // force an update from torrent clients after 1.5 second to show the user that the torrent has been added.
                    }, 1500);
                } else {
                    var d = document.createElement('iframe');
                    d.id = 'torrenturl_' + new Date().getTime();
                    d.name = 'torrenturl_' + new Date().getTime();
                    d.style.visibility = 'hidden';
                    d.src = torrentUrl;
                    document.body.appendChild(d);
                    //console.debug("Adding via Chromium! ", d.id, magnet, TVDB_ID);
                    var dTimer = setInterval(function () {
                        var dDoc = d.contentDocument || d.contentWindow.document;
                        if (dDoc.readyState == 'complete') {
                            document.body.removeChild(d);
                            clearInterval(dTimer);
                            return;
                        }
                    }, 1500);
                }
            }
        }; 

        init();
        service.setDefault(SettingsService.get('torrenting.searchprovider'));
        return service;
    }
]);