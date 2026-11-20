import { Alert } from 'react-native';

// react-native-web ships Alert.alert as an empty function, so every confirm
// in the app would silently do nothing. Loaded once from index.js on web.
// shortcut: blocking browser dialogs, and a third button is ignored; replace with an in-app dialog when the web UI is designed.
Alert.alert = (title, message, buttons = []) => {
  const text = [title, message].filter(Boolean).join('\n\n');
  if (buttons.length < 2) {
    window.alert(text);
    buttons[0]?.onPress?.();
    return;
  }
  const cancel = buttons.find((b) => b.style === 'cancel') || buttons[0];
  const confirm = buttons.find((b) => b !== cancel);
  (window.confirm(text) ? confirm : cancel).onPress?.();
};
