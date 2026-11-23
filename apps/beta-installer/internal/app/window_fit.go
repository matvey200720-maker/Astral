package app

// FitWindowHeight turns the page's request into a height the window can take:
// never below WindowHeight and never above MaxWindowHeight.
func FitWindowHeight(cssHeight int) int {
	switch {
	case cssHeight < WindowHeight:
		return WindowHeight
	case cssHeight > MaxWindowHeight:
		return MaxWindowHeight
	}
	return cssHeight
}

// MaxWindowHeight is the tallest the installer window may grow, in CSS
// pixels. Above it the step body scrolls and the footer stays at the bottom.
const MaxWindowHeight = 1200
