// Web replacement for @react-native-community/datetimepicker (wired in metro.config.js).
// shortcut: renders nothing, so dates cannot be changed on web; replace with an <input type="date"> when the date picker is in scope.
export default function DateTimePicker() {
  return null;
}
