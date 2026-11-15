package main

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/nirvanacp/let/go/servelet"
)

func init() {
	if err := servelet.Migrate(schemaV1); err != nil {
		panic(err)
	}
	e := echo.New()
	e.GET("/health", echo.WrapHandler(http.HandlerFunc(health)))
	e.GET("/v1/notes", echo.WrapHandler(http.HandlerFunc(listNotes)))
	e.POST("/v1/notes", echo.WrapHandler(http.HandlerFunc(createNote)))
	e.GET("/v1/notes/:id", func(c echo.Context) error { getNote(c.Response(), c.Request(), c.Param("id"), http.StatusOK); return nil })
	e.PUT("/v1/notes/:id", func(c echo.Context) error { updateNote(c.Response(), c.Request(), c.Param("id")); return nil })
	e.DELETE("/v1/notes/:id", func(c echo.Context) error { deleteNote(c.Response(), c.Request(), c.Param("id")); return nil })
	servelet.Serve(e)
}

// main stays empty: the host calls the handler that init registered.
func main() {}
