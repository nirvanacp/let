//go:build wasip1

package servelet

import (
	"runtime"
	"unsafe"
)

// Imports from the host, module "let" (ABI 1).

// letSQL runs one database request, a JSON document, keeps the JSON reply in the host and
// returns its length in bytes.
//
//go:wasmimport let sql
func letSQL(ptr, length uint32) uint32

// letSQLReply copies the reply of the last letSQL call into the guest buffer at ptr, which holds
// at least as many bytes as letSQL returned.
//
//go:wasmimport let sql_reply
func letSQLReply(ptr uint32)

// letLog writes one log line.
//
//go:wasmimport let log
func letLog(level, ptr, length uint32)

// Buffers the host asked for with let_alloc, kept alive until the next let_handle call.
var allocated = map[uint32][]byte{}

// The last reply of let_handle, kept alive until the next let_handle call.
var lastReply []byte

func pointer(b []byte) uint32 {
	if len(b) == 0 {
		return 0
	}
	return uint32(uintptr(unsafe.Pointer(unsafe.SliceData(b))))
}

// letAlloc returns a buffer of length bytes for the host to write a request into.
//
//go:wasmexport let_alloc
func letAlloc(length uint32) uint32 {
	b := make([]byte, max(length, 1))
	p := pointer(b)
	allocated[p] = b
	return p
}

// letHandle answers one request: a JSON document in a buffer from let_alloc. It returns the reply
// as pointer << 32 | length.
//
//go:wasmexport let_handle
func letHandle(ptr, length uint32) uint64 {
	var request []byte
	if b, ok := allocated[ptr]; ok && int(length) <= len(b) {
		request = b[:length]
	}
	clear(allocated)
	reply := dispatch(request)
	lastReply = reply
	return uint64(pointer(reply))<<32 | uint64(len(reply))
}

func hostCall(request []byte) []byte {
	n := letSQL(pointer(request), uint32(len(request)))
	runtime.KeepAlive(request)
	reply := make([]byte, n)
	if n > 0 {
		letSQLReply(pointer(reply))
	}
	return reply
}

func hostLog(level int, line string) {
	b := []byte(line)
	letLog(uint32(level), pointer(b), uint32(len(b)))
	runtime.KeepAlive(b)
}
