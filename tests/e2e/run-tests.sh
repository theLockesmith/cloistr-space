#!/bin/bash

# E2E Test Runner Script for Cloistr Space
# Provides convenient commands for running Playwright tests

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "package.json not found. Run this script from the project root."
    exit 1
fi

# Check if Playwright is installed
if [ ! -d "node_modules/playwright" ]; then
    print_error "Playwright not found. Run 'pnpm install' first."
    exit 1
fi

# Function to install browsers if needed
install_browsers() {
    print_status "Installing Playwright browsers..."
    pnpm run playwright:install
    print_success "Browsers installed successfully"
}

# Function to run tests
run_tests() {
    local mode="$1"

    case "$mode" in
        "ui")
            print_status "Running tests in UI mode..."
            pnpm run test:e2e:ui
            ;;
        "headed")
            print_status "Running tests in headed mode..."
            pnpm run test:e2e:headed
            ;;
        "debug")
            print_status "Running tests in debug mode..."
            pnpm run test:e2e:debug
            ;;
        *)
            print_status "Running all E2E tests..."
            pnpm run test:e2e
            ;;
    esac
}

# Function to run specific test file
run_specific_test() {
    local test_file="$1"
    print_status "Running specific test: $test_file"
    pnpm exec playwright test "$test_file"
}

# Function to show help
show_help() {
    echo "E2E Test Runner for Cloistr Space"
    echo ""
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  install     Install Playwright browsers"
    echo "  test        Run all E2E tests (default)"
    echo "  ui          Run tests with interactive UI"
    echo "  headed      Run tests with visible browser"
    echo "  debug       Run tests in debug mode"
    echo "  file        Run specific test file (requires filename)"
    echo "  help        Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                     # Run all tests"
    echo "  $0 ui                  # Run with interactive UI"
    echo "  $0 file auth.spec.ts   # Run only auth tests"
    echo "  $0 install             # Install browsers"
    echo ""
}

# Main script logic
case "${1:-test}" in
    "install")
        install_browsers
        ;;
    "test")
        run_tests
        ;;
    "ui")
        run_tests "ui"
        ;;
    "headed")
        run_tests "headed"
        ;;
    "debug")
        run_tests "debug"
        ;;
    "file")
        if [ -z "$2" ]; then
            print_error "Please specify a test file"
            echo "Example: $0 file auth.spec.ts"
            exit 1
        fi
        run_specific_test "$2"
        ;;
    "help"|"-h"|"--help")
        show_help
        ;;
    *)
        print_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac

print_success "Done!"