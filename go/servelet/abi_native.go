//go:build !wasip1

package servelet

const native = "servelet: this build runs only inside the host; build it with let-servelet build"

func hostCall([]byte) []byte { panic(native) }

func hostLog(int, string) { panic(native) }
