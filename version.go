package main

import (
	_ "embed"
	"encoding/json"
)

//go:embed wails.json
var projectConfig []byte

var product = loadProduct()

type productInfo struct {
	Name    string `json:"productName"`
	Version string `json:"productVersion"`
}

func loadProduct() productInfo {
	var config struct{ Info productInfo }
	if err := json.Unmarshal(projectConfig, &config); err != nil {
		panic(err)
	}
	return config.Info
}
