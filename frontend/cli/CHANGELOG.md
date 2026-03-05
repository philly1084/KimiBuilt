# Changelog

All notable changes to the KimiBuilt CLI will be documented in this file.

## [2.0.0] - 2025-03-04

### Major Upgrade - Premium CLI Experience

This release represents a major upgrade to the KimiBuilt CLI, transforming it into a premium, polished tool comparable to modern AI CLIs like Claude Code, Codex CLI, and OpenCode.

### Added

#### Visual Polish & UX
- **ASCII Art Banner**: Added beautiful gradient ASCII art banner using figlet
- **Gradient Colors**: Integrated gradient-string for eye-catching headers
- **Loading Spinners**: Added ora spinners for all async operations
- **Boxed Output**: Clean, organized output with box drawing characters
- **Themes**: Four built-in themes (default, minimal, colorful, dark)
- **Response Time Tracking**: Shows duration for all API operations
- **Better Prompt**: Colored, distinct prompt for user input
- **Auto-completion**: Tab completion for all commands

#### Session Management
- **Session History**: Track up to 50 past sessions with metadata
- **Session Rename**: Name your sessions for easy identification
- **Export Sessions**: Export any session to JSON file
- **Import Sessions**: Import sessions from JSON files
- **Session Persistence**: Sessions now survive CLI restarts
- **Better Session Display**: Shows mode, date, and name in listings

#### Commands
- `/config` - Display all configuration settings
- `/theme [name]` - Change visual theme
- `/export [file]` - Export current session
- `/import <file>` - Import session from file
- `/rename <name>` - Rename current session
- `/delete [id]` - Delete a specific session
- `/version` or `/v` - Show CLI version

#### Configuration
- **Environment Variable Support**: `KIMIBUILT_API_URL` override
- **Validation**: Config values are validated before saving
- **Secure Permissions**: Config files created with 0o600 permissions
- **More Options**: New settings for timestamps, streaming, themes

#### Error Handling
- **Custom APIError Class**: Structured error information
- **Helpful Messages**: Actionable error messages with troubleshooting tips
- **Connection Errors**: Specific handling for common network issues
- **Timeout Handling**: 30-second default timeout with clear messages
- **Status Code Awareness**: Different messages for different HTTP status codes

#### API Client
- **HTTPS Support**: Now supports both HTTP and HTTPS APIs
- **Health Check**: API connectivity check on startup
- **Request Timeouts**: Configurable timeout for all requests
- **Better SSE Parsing**: More robust Server-Sent Events handling
- **User-Agent Header**: Proper identification in requests

#### CLI Arguments
- `--version` or `-v` - Show version
- `--help` or `-h` - Show usage information
- `--api-url <url>` - Set API URL from command line
- `--mode <mode>` - Set mode from command line
- `--theme <theme>` - Set theme from command line
- `--no-stream` - Disable streaming (for piped input)

### Improved

#### Code Quality
- **Better Code Organization**: Separated concerns, cleaner functions
- **JSDoc Comments**: Better documentation for all functions
- **Consistent Naming**: Unified naming conventions
- **Error Boundaries**: Better error catching and reporting

#### User Experience
- **Faster Feedback**: Immediate spinner on async operations
- **Keyboard Shortcuts**: Ctrl+C (cancel/exit), Ctrl+L (clear)
- **Command History**: Navigate previous commands with arrow keys
- **Better Help**: Comprehensive help with examples
- **Color Coding**: Consistent use of colors (red=error, green=success, etc.)

#### Markdown Rendering
- **GFM Support**: GitHub Flavored Markdown enabled
- **Better Syntax Highlighting**: Improved code block rendering
- **Line Breaks**: Proper handling of soft breaks

### Fixed

#### Bugs
- **HTTPS Support**: CLI now properly handles HTTPS URLs
- **Port Handling**: Correct default ports for HTTP (80) and HTTPS (443)
- **Session File Permissions**: Config directory now created with 0o700
- **Empty Response Handling**: Better handling of empty API responses
- **Stream End Detection**: Proper detection of SSE stream completion
- **Signal Handling**: Improved Ctrl+C handling during processing

#### Edge Cases
- **Piped Input**: More robust handling of piped stdin
- **Terminal Resize**: Graceful handling of terminal resize events
- **Very Long Lines**: Better handling of long output lines
- **Unicode Characters**: Improved Unicode support in output

### Dependencies

#### Added
- `ora@^5.4.1` - Terminal spinners
- `figlet@^1.7.0` - ASCII art text
- `gradient-string@^2.0.2` - Gradient colors
- `cli-boxes@^3.0.0` - Box drawing characters
- `minimist@^1.2.8` - Command line argument parsing
- `clipboardy@^2.3.0` - Clipboard access (preparation for future)
- `strip-ansi@^6.0.1` - ANSI stripping utilities

#### Updated
- `marked@^9.1.6` → `marked@^12.0.0` - Markdown parser
- `marked-terminal@^6.2.0` → `marked-terminal@^7.0.0` - Terminal renderer

#### Dev Dependencies Added
- `eslint@^8.57.0` - Code linting
- `jest@^29.7.0` - Testing framework
- `prettier@^3.2.5` - Code formatting

### Documentation
- **Comprehensive README**: Updated with all new features
- **Usage Examples**: More examples for different use cases
- **Troubleshooting Guide**: Common issues and solutions
- **Keyboard Shortcuts**: Reference table
- **Environment Variables**: Complete reference

### Breaking Changes
- **Node Version**: Minimum Node.js version increased to 16.0.0
- **Config Format**: Config file structure has new fields (backwards compatible)
- **Default Behavior**: Now performs health check on startup (can be disabled)

---

## [1.0.0] - Initial Release

### Features
- Interactive REPL with streaming responses
- Session persistence
- Multiple modes: chat, canvas, notation
- Markdown rendering in terminal
- Configurable API base URL
- Pipe support for scripting
- Basic command set: /new, /mode, /history, /sessions, /clear, /help, /quit

### Dependencies
- chalk@^4.1.2
- marked@^9.1.6
- marked-terminal@^6.2.0
- readline@^1.3.0
