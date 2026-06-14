package main

import (
	"io"
	"log"
	"net/http"
	"os"
)

func main() {
	// TODO: run transcriber basics

	if err := DownloadFromURL("http://103.170.232.132:8080"); err != nil {
		log.Fatal("failed to download")
	}

	// result, err := Transcribe()
	// if err != nil {
	// 	fmt.Println(result)
	// }
}

func DownloadFromURL(url string) error {
	tmpfile, err := os.Create("output")
	if err != nil {
		return err
	}
	defer tmpfile.Close()

	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	_, err = io.Copy(tmpfile, resp.Body)
	if err != nil {
		return err
	}

	log.Println("success download from url")

	return nil
}
