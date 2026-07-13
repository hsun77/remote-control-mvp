#include <ApplicationServices/ApplicationServices.h>
#include <node_api.h>

#include <algorithm>
#include <cstdint>
#include <cmath>
#include <map>
#include <string>

namespace {

bool get_named(napi_env env, napi_value object, const char* name, napi_value* value) {
  bool has = false;
  napi_has_named_property(env, object, name, &has);
  if (!has) return false;
  return napi_get_named_property(env, object, name, value) == napi_ok;
}

std::string get_string(napi_env env, napi_value object, const char* name) {
  napi_value value;
  if (!get_named(env, object, name, &value)) return "";
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) return "";
  std::string result(length, '\0');
  napi_get_value_string_utf8(env, value, result.data(), result.size() + 1, &length);
  return result;
}

double get_number(napi_env env, napi_value object, const char* name, double fallback = 0.0) {
  napi_value value;
  if (!get_named(env, object, name, &value)) return fallback;
  double result = fallback;
  napi_get_value_double(env, value, &result);
  return result;
}

int32_t get_int(napi_env env, napi_value object, const char* name, int32_t fallback = 0) {
  napi_value value;
  if (!get_named(env, object, name, &value)) return fallback;
  int32_t result = fallback;
  napi_get_value_int32(env, value, &result);
  return result;
}

napi_value make_result(napi_env env, bool ok, const std::string& error = "") {
  napi_value object;
  napi_create_object(env, &object);

  napi_value ok_value;
  napi_get_boolean(env, ok, &ok_value);
  napi_set_named_property(env, object, "ok", ok_value);

  napi_value error_value;
  napi_create_string_utf8(env, error.c_str(), error.size(), &error_value);
  napi_set_named_property(env, object, "error", error_value);

  return object;
}

CGPoint event_position(napi_env env, napi_value event) {
  napi_value display;
  get_named(env, event, "display", &display);

  const double nx = std::clamp(get_number(env, event, "x", 0.5), 0.0, 1.0);
  const double ny = std::clamp(get_number(env, event, "y", 0.5), 0.0, 1.0);
  const double dx = get_number(env, display, "x", 0.0);
  const double dy = get_number(env, display, "y", 0.0);
  const double dw = get_number(env, display, "width", 1.0);
  const double dh = get_number(env, display, "height", 1.0);

  return CGPointMake(dx + nx * dw, dy + ny * dh);
}

CGMouseButton mouse_button(int32_t button) {
  if (button == 2) return kCGMouseButtonRight;
  if (button == 1) return kCGMouseButtonCenter;
  return kCGMouseButtonLeft;
}

CGEventType mouse_down_type(CGMouseButton button) {
  if (button == kCGMouseButtonRight) return kCGEventRightMouseDown;
  if (button == kCGMouseButtonCenter) return kCGEventOtherMouseDown;
  return kCGEventLeftMouseDown;
}

CGEventType mouse_up_type(CGMouseButton button) {
  if (button == kCGMouseButtonRight) return kCGEventRightMouseUp;
  if (button == kCGMouseButtonCenter) return kCGEventOtherMouseUp;
  return kCGEventLeftMouseUp;
}

bool post_mouse(CGEventType type, CGPoint point, CGMouseButton button) {
  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  if (!source) return false;
  CGEventRef event = CGEventCreateMouseEvent(source, type, point, button);
  CFRelease(source);
  if (!event) return false;
  CGEventPost(kCGHIDEventTap, event);
  CFRelease(event);
  return true;
}

bool post_scroll(int32_t delta_y) {
  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  if (!source) return false;
  CGEventRef event = CGEventCreateScrollWheelEvent(source, kCGScrollEventUnitPixel, 2, -delta_y, 0);
  CFRelease(source);
  if (!event) return false;
  CGEventPost(kCGHIDEventTap, event);
  CFRelease(event);
  return true;
}

uint16_t key_code_for(const std::string& code, const std::string& key) {
  static const std::map<std::string, uint16_t> codes = {
      {"KeyA", 0},       {"KeyS", 1},      {"KeyD", 2},       {"KeyF", 3},
      {"KeyH", 4},       {"KeyG", 5},      {"KeyZ", 6},       {"KeyX", 7},
      {"KeyC", 8},       {"KeyV", 9},      {"KeyB", 11},      {"KeyQ", 12},
      {"KeyW", 13},      {"KeyE", 14},     {"KeyR", 15},      {"KeyY", 16},
      {"KeyT", 17},      {"Digit1", 18},   {"Digit2", 19},    {"Digit3", 20},
      {"Digit4", 21},    {"Digit6", 22},   {"Digit5", 23},    {"Equal", 24},
      {"Digit9", 25},    {"Digit7", 26},   {"Minus", 27},     {"Digit8", 28},
      {"Digit0", 29},    {"KeyO", 31},     {"KeyU", 32},      {"KeyI", 34},
      {"KeyP", 35},      {"Enter", 36},    {"KeyL", 37},      {"KeyJ", 38},
      {"Quote", 39},     {"KeyK", 40},     {"Semicolon", 41}, {"Backslash", 42},
      {"Comma", 43},     {"Slash", 44},    {"KeyN", 45},      {"KeyM", 46},
      {"Period", 47},    {"Tab", 48},      {"Space", 49},     {"Backquote", 50},
      {"Backspace", 51}, {"Escape", 53},   {"MetaLeft", 55},  {"MetaRight", 55},
      {"ShiftLeft", 56}, {"CapsLock", 57}, {"AltLeft", 58},   {"AltRight", 58},
      {"ControlLeft", 59}, {"ControlRight", 59}, {"ShiftRight", 60},
      {"ArrowLeft", 123}, {"ArrowRight", 124}, {"ArrowDown", 125}, {"ArrowUp", 126},
      {"F1", 122},       {"F2", 120},      {"F3", 99},        {"F4", 118},
      {"F5", 96},        {"F6", 97},       {"F7", 98},        {"F8", 100},
      {"F9", 101},       {"F10", 109},     {"F11", 103},      {"F12", 111},
  };

  auto found = codes.find(code);
  if (found != codes.end()) return found->second;
  if (key == "Enter") return 36;
  if (key == "Tab") return 48;
  if (key == " " || key == "Spacebar") return 49;
  if (key == "Backspace") return 51;
  if (key == "Escape") return 53;
  return UINT16_MAX;
}

bool post_key(uint16_t key_code, bool down) {
  if (key_code == UINT16_MAX) return true;
  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  if (!source) return false;
  CGEventRef event = CGEventCreateKeyboardEvent(source, key_code, down);
  CFRelease(source);
  if (!event) return false;
  CGEventPost(kCGHIDEventTap, event);
  CFRelease(event);
  return true;
}

napi_value IsTrusted(napi_env env, napi_callback_info info) {
  return make_result(env, AXIsProcessTrusted(), AXIsProcessTrusted() ? "" : "Remote Control MVP is not trusted for Accessibility");
}

napi_value SendInput(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) return make_result(env, false, "Missing input event");

  if (!AXIsProcessTrusted()) {
    return make_result(env, false, "Remote Control MVP is not trusted for Accessibility");
  }

  const std::string type = get_string(env, argv[0], "type");
  bool ok = true;

  if (type == "mouseMove") {
    const int32_t buttons = get_int(env, argv[0], "buttons", 0);
    ok = post_mouse((buttons & 1) ? kCGEventLeftMouseDragged : kCGEventMouseMoved,
                    event_position(env, argv[0]), kCGMouseButtonLeft);
  } else if (type == "mouseDown") {
    const CGMouseButton button = mouse_button(get_int(env, argv[0], "button", 0));
    ok = post_mouse(mouse_down_type(button), event_position(env, argv[0]), button);
  } else if (type == "mouseUp") {
    const CGMouseButton button = mouse_button(get_int(env, argv[0], "button", 0));
    ok = post_mouse(mouse_up_type(button), event_position(env, argv[0]), button);
  } else if (type == "wheel") {
    ok = post_scroll(static_cast<int32_t>(std::round(get_number(env, argv[0], "deltaY", 0.0))));
  } else if (type == "keyDown" || type == "keyUp") {
    ok = post_key(key_code_for(get_string(env, argv[0], "code"), get_string(env, argv[0], "key")),
                  type == "keyDown");
  }

  return make_result(env, ok, ok ? "" : "CoreGraphics input injection failed");
}

napi_value Init(napi_env env, napi_value exports) {
  napi_value is_trusted;
  napi_create_function(env, "isTrusted", NAPI_AUTO_LENGTH, IsTrusted, nullptr, &is_trusted);
  napi_set_named_property(env, exports, "isTrusted", is_trusted);

  napi_value send_input;
  napi_create_function(env, "sendInput", NAPI_AUTO_LENGTH, SendInput, nullptr, &send_input);
  napi_set_named_property(env, exports, "sendInput", send_input);

  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
