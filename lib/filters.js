
var utils = require('utilities');


var filters = {

  processFilters : function(filterData, filteredValue, item) {
    if (filterData instanceof Array) {
      for (var i = 0; i < filterData.length; i++) {
        filteredValue = this.processOneFilter(filteredValue, filterData[i], item);
      }
      return filteredValue;
    }
    else {
      return this.processOneFilter(filteredValue, filterData, item);
    }
  },

  processOneFilter : function (paramValue, filter, item) {
    var paramValueStr = paramValue + ''; // force string

    switch (typeof filter) {
      case 'string':
        switch (filter)
        {
          case 'trim':
            return utils.string.trim(paramValueStr);

          case 'ltrim':
            return utils.string.ltrim(paramValueStr);

          case 'rtrim':
            return utils.string.rtrim(paramValueStr);

          case 'uppercase':
            return paramValueStr.toUpperCase();

          case 'lowercase':
            return paramValueStr.toLowerCase();

          default:
            if (typeof item[filter] == 'function' ) {
              return item[filter].call(item, paramValue); // not forced string on purpose
            }
            break;
        }
        break;

      case 'object':
        if (filter instanceof RegExp) {
          return paramValueStr.replace(filter, '');
        }

        if (filter.type == 'replace' ) {
          return paramValueStr.replace(filter.search, filter.replacement, filter.flags);
        }
        break;

      case 'function':
        return filter.call(item, paramValueStr);
    }

    throw new Error( 'Unknown filter: "' + filter + '"' );
  }
};

module.exports = filters;
