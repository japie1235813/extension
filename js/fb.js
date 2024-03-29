/*global FB, chrome, DB, _ */

(function(chrome, undefined){
  "use strict";

  // Pub/sub interface
  var
  SCOPES = ["friends_groups", "user_photos"],
  SUCCESS_URL = "https://www.facebook.com/connect/login_success.html",
  LOGIN_URL = "https://www.facebook.com/dialog/oauth?client_id=" +
    "224887097626771&response_type=token&" +
    "scope=" + SCOPES.join(',') + "&" +
    "redirect_uri=" + SUCCESS_URL,
  API_URL = "https://graph.facebook.com/",
  callbacks = {
    loggedIn: $.Callbacks('unique memory')
  };

  // facebook Pub/sub and GET request interface
  window.FB = {
    _loginTabId: null,

    // Check if the eventType is available to subscribe.
    _check : function(eventType){
      if(!callbacks[eventType]){
        console.error('Undefined event type for myFB');
        return false;
      }
      return true;
    },

    // Event handler of login tab URL change.
    // It seeks for target page that contains accessToken info.
    _facebookLogin : function(tabId, changeInfo, tab){
      // check if the login tab achieves success state
      console.log('Tab change info:', changeInfo, tab, FB._loginTabId);
      if(changeInfo.status === 'complete' && tabId === FB._loginTabId && tab.url.indexOf(SUCCESS_URL) === 0){
        var result = tab.url.match(/access_token=(\w+)/);
        if(result){

          // Store the access token to local storage
          localStorage.accessToken = result[1];
          console.log(localStorage.accessToken);

          // Close tab and reset
          chrome.tabs.onUpdated.removeListener(FB._facebookLogin);
          chrome.tabs.remove(FB._loginTabId);
          FB._loginTabId = null;

          // fire loggedIn callback
          callbacks.loggedIn.fire();
        }
      }
    },

    // pub/sub interface
    subscribe : function(eventType, func){
      if(this._check(eventType)){
        callbacks[eventType].add(func);
      }
      return this;
    },

    // pub/sub interface
    unsubscribe : function(eventType, func){
      if(this._check(eventType)){
        callbacks[eventType].remove(func);
      }
      return this;
    },

    // Log the user in, whose process continues in FB._facebookLogin.
    login: function(){
      chrome.tabs.create({
        url: LOGIN_URL
      }, function(tab){
        FB._loginTabId = tab.id;
        chrome.tabs.onUpdated.addListener(FB._facebookLogin);
      });
    },

    // Check if a string is in a form of facebook ID.
    // If so, return the facebook id.
    // else, return false.
    ID: function(str){
      if(!str){
        return false;
      }

      // normalize str if the ID is GROUPID_FBID
      str = str.split('_').slice(-1)[0];

      var ids = str.match(/\d+/);
      return (ids && ids[0] === str) && ids[0];
    },

    setType: function(feed){
      if(this.ID(feed.id) && !feed.type){
        if(feed.link){
          feed.type = "link";
        }else{
          feed.type = "status";
        }
      }
    },

    // Send GET requests to facebook graph API.
    // Usage: FB.get('me/feed', function(data){...})
    //        FB.get('me/feed', {limit:10}, function(data){...})
    get: function(url, data, successCallback, failCallback){

      // normalize the arguments
      if($.isFunction(data)){
        successCallback = data;
        data = {};
      }

      // If no access token
      if(!localStorage.accessToken){
        // Retry after logged in
        FB.subscribe('loggedIn', function retry(){
          FB.get(url, data, successCallback, failCallback);
          FB.unsubscribe('loggedIn', retry);
        });
        // trigger login
        FB.login();
      }

      // If has access token, send query via ajax
      else {
        $.getJSON(API_URL + url, $.extend({
          access_token: localStorage.accessToken
        }, data), function(data){

          // set type attribute
          var i;
          if(FB.ID(_.keys(data)[0])){ // dictionary of FB data
            $.each(data, function(k){
              FB.setType(data[k]);
            });
          }else{ // single FB data
            FB.setType(data);
          }

          // invoke success callback
          successCallback(data);
        }).fail(function(jqXHR){
          if(jqXHR.responseText){
            var err = $.parseJSON(jqXHR.responseText).error;
            console.error('Error while requesting "'+url+'" : ', err);

            // Check if access token is invalid (error code 190).
            // If so, clean up access token and try again.
            if(err.code === 190){
              delete localStorage.accessToken;
              FB.get(url, data, successCallback, failCallback);
            } else if (failCallback) {
              failCallback(arguments);
            }
          }
          if (failCallback){
            failCallback(arguments);
          }
        });
      }

      return FB; // enable chaining
    }
  };
}(chrome));