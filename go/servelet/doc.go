// Package servelet runs a Go HTTP handler as a Let servelet: a small backend that the host loads
// as a WebAssembly module and calls with one request at a time, with a SQLite database of its own.
//
// A servelet registers its handler in init and keeps main empty:
//
//	func init() {
//		if err := servelet.Migrate(schemaV1); err != nil {
//			panic(err)
//		}
//		mux := http.NewServeMux()
//		mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
//			servelet.JSON(w, http.StatusOK, map[string]bool{"ready": true})
//		})
//		servelet.Serve(mux)
//	}
//
//	func main() {}
//
// Build it with let-servelet build. A build for the computer compiles, so go vet works, but every
// database or log call panics.
//
// The handler runs synchronously. Goroutines it starts pause when it returns, timers do not fire
// between requests, and the module cannot open files, sockets or network connections.
package servelet
