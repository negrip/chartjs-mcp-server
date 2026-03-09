# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.2.0] - 2026-03-09

### Added
- JSON output format (`outputFormat: 'json'`) for client-side chart rendering
- Returns raw Chart.js config object instead of HTML or PNG
- Ideal for React/Next.js apps using libraries like assistant-ui
- Example integration with assistant-ui's `makeAssistantToolUI` (`examples/assistant-ui-integration.example.tsx`)
- Tests for JSON output format (27 tests across 10 suites)

## [3.1.6] - 2025-12-23

### Fixed
- Set MIME type as text/html for HTML chart snippet responses (#4)

## [3.1.5] - 2025-07-08

### Fixed
- Accept stringified JSON for chart configuration input

## [3.1.4] - 2025-07-07

### Added
- Chart configuration validation with comprehensive error handling

### Changed
- Updated package dependencies

### Fixed
- JSON schema now compatible with all LLMs
- Schema updates for better validation

## [3.1.3] - 2025-07-06

### Fixed
- Chart options type handling

## [3.1.2] - 2025-07-05

### Fixed
- Use cleanedConfig for proper chart rendering

## [3.1.1] - 2025-07-03

### Changed
- Updated README.md with improved documentation

## [3.1.0] - 2025-07-03

### Added
- Interactive HTML chart output format
- Self-contained HTML divs with embedded Chart.js
- Support for hover tooltips and animations in HTML format
- Framework-agnostic HTML output (works with React, Vue, Angular, vanilla JS)

### Changed
- Enhanced output format options (PNG and HTML)

## [3.0.0] - 2025-07-03

### Added
- Initial public release
- MCP server implementation for Chart.js v4
- Support for 8 chart types: Bar, Line, Pie, Doughnut, Scatter, Bubble, Radar, Polar Area
- PNG image output (800x600px)
- Comprehensive test suite (24 tests across 9 suites)
- TypeScript support
- Example configurations for all chart types
- Complete documentation

### Technical
- Built with @modelcontextprotocol/sdk
- Server-side rendering with Node Canvas
- Chart.js v4 integration
- Full Chart.js options support

---

## Version History Summary

- **3.2.0** - Added JSON output format for client-side rendering
- **3.1.x** - Incremental improvements, validation, and bug fixes
- **3.1.0** - Added interactive HTML output format
- **3.0.0** - Initial release with PNG support

[Unreleased]: https://github.com/ax-crew/chartjs-mcp-server/compare/v3.2.0...HEAD
[3.2.0]: https://github.com/ax-crew/chartjs-mcp-server/compare/v3.1.6...v3.2.0
[3.1.6]: https://github.com/ax-crew/chartjs-mcp-server/compare/v3.1.5...v3.1.6
[3.1.5]: https://github.com/ax-crew/chartjs-mcp-server/compare/v3.1.4...v3.1.5
[3.1.4]: https://github.com/ax-crew/chartjs-mcp-server/compare/v3.1.3...v3.1.4
[3.1.3]: https://github.com/ax-crew/chartjs-mcp-server/compare/v3.1.2...v3.1.3
[3.1.2]: https://github.com/ax-crew/chartjs-mcp-server/compare/v3.1.1...v3.1.2
[3.1.1]: https://github.com/ax-crew/chartjs-mcp-server/compare/v3.1.0...v3.1.1
[3.1.0]: https://github.com/ax-crew/chartjs-mcp-server/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/ax-crew/chartjs-mcp-server/releases/tag/v3.0.0
