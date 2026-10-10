// Pin the test clock's timezone. The date helpers under test work in
// *local* time on purpose (a calendar day is the day the user sees), so
// their results depend on the machine's TZ. Madagascar (UTC+3, no DST)
// is both the maker's zone and the one that exposed the UTC-shift bug
// `utils/dateString.js` exists to prevent. Tests run there everywhere.
module.exports = async () => {
  process.env.TZ = 'Indian/Antananarivo';
};
