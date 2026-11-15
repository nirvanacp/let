package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/nirvanacp/let/go/servelet"
)

func init() {
	if err := servelet.Migrate(schemaV1); err != nil {
		panic(err)
	}
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Recovery())
	r.GET("/health", gin.WrapF(health))
	r.GET("/v1/notes", gin.WrapF(listNotes))
	r.POST("/v1/notes", gin.WrapF(createNote))
	r.GET("/v1/notes/:id", func(c *gin.Context) { getNote(c.Writer, c.Request, c.Param("id"), http.StatusOK) })
	r.PUT("/v1/notes/:id", func(c *gin.Context) { updateNote(c.Writer, c.Request, c.Param("id")) })
	r.DELETE("/v1/notes/:id", func(c *gin.Context) { deleteNote(c.Writer, c.Request, c.Param("id")) })
	servelet.Serve(r)
}

// main stays empty: the host calls the handler that init registered.
func main() {}
